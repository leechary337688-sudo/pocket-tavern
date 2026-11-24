// publish-view — 三步发布：打包 → 确认分级 → 上传/导出。每一步都可退回。
import { h, clear } from './dom.js';
import { icon } from './icons.js';
import { openOverlay } from './overlay.js';
import { toast, toastError } from './toast.js';
import { buildPack, downloadPack } from '../workshop/packer.js';
import { publishPack } from '../workshop/registry.js';

function slugId(title) {
  const base = String(title || 'work')
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fa5]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 36) || 'work';
  return `${base}-${Date.now().toString(36)}`;
}

function field(label, control, hint = '') {
  return h('label', { class: 'publish-field' },
    h('span', { class: 'publish-field__label' }, label),
    control,
    hint ? h('span', { class: 'publish-field__hint' }, hint) : null);
}

/**
 * 打开发布流程。card / world 二选一或同时提供（bundle）。
 */
export function openPublishFlow({ type, card = null, world = null, settings = {}, repo, onPublished, onClose } = {}) {
  const packType = type || (card && world ? 'bundle' : card ? 'card' : 'world');
  const title = card?.name || world?.name || '未命名作品';
  const meta = {
    id: slugId(title),
    title,
    version: '1.0.0',
    author: String(settings?.personaName || card?.creator || '匿名酒客').slice(0, 60),
    tags: [...(card?.tags || [])].slice(0, 8),
    contentRating: 'general',
    changelog: '第一次发布。',
    description: String(card?.description || world?.name || '').slice(0, 300),
  };
  let step = 1;
  let pack = null;
  let confirmed = false;
  let busy = false;
  let publishedItem = null;

  const body = h('div', { class: 'publish-flow' });
  const overlay = openOverlay({
    title: '发布作品',
    subtitle: '三步：打包 → 分级确认 → 上传或导出',
    content: body,
    className: 'publish-overlay',
    dismissible: true,
    onClose: () => onClose?.(),
  });

  function stepDots() {
    return h('div', { class: 'publish-steps', 'aria-label': `第 ${step} 步，共 3 步` },
      [1, 2, 3].map((n) => h('span', { class: `publish-step ${step === n ? 'is-on' : ''} ${step > n ? 'is-done' : ''}` }, String(n))),
    );
  }

  function footer(buttons) {
    return h('div', { class: 'publish-actions' }, ...buttons);
  }

  function resetScroll() {
    requestAnimationFrame(() => {
      const scroller = body.parentElement;
      if (scroller && typeof scroller.scrollTo === 'function') scroller.scrollTo({ top: 0 });
      else if (scroller) scroller.scrollTop = 0;
    });
  }

  function button(label, { primary = false, quiet = false, disabled = false, iconName = '', onClick } = {}) {
    const btn = h('button', {
      class: `btn ${primary ? 'btn--primary' : quiet ? 'btn--quiet' : 'btn--ghost'}`,
      type: 'button',
      disabled,
    }, iconName ? icon(iconName, { size: 16 }) : null, label);
    btn.addEventListener('click', onClick);
    return btn;
  }

  function renderStep1() {
    clear(body);
    const titleInput = h('input', { class: 'field', value: meta.title, maxlength: '80', 'aria-label': '作品标题' });
    const authorInput = h('input', { class: 'field', value: meta.author, maxlength: '60', 'aria-label': '作者' });
    const versionInput = h('input', { class: 'field', value: meta.version, maxlength: '24', 'aria-label': '版本' });
    const tagsInput = h('input', { class: 'field', value: meta.tags.join(', '), maxlength: '120', 'aria-label': '标签' });
    const descInput = h('textarea', { class: 'field field--area', rows: '3', maxlength: '600', 'aria-label': '简介' }, meta.description);
    const changeInput = h('textarea', { class: 'field field--area', rows: '3', maxlength: '800', 'aria-label': '更新日志' }, meta.changelog);

    titleInput.addEventListener('input', () => { meta.title = titleInput.value; });
    authorInput.addEventListener('input', () => { meta.author = authorInput.value; });
    versionInput.addEventListener('input', () => { meta.version = versionInput.value; });
    tagsInput.addEventListener('input', () => {
      meta.tags = tagsInput.value.split(/[,，、#]/).map((t) => t.trim()).filter(Boolean).slice(0, 8);
    });
    descInput.addEventListener('input', () => { meta.description = descInput.value; });
    changeInput.addEventListener('input', () => { meta.changelog = changeInput.value; });

    body.append(
      stepDots(),
      h('p', { class: 'publish-lead' }, `把「${title}」装进 .ptpack。发布前可以改标题、作者和版本；文件里不会带 API Key。`),
      h('div', { class: 'publish-summary' },
        h('span', { class: 'publish-summary__type' }, packType === 'world' ? '世界书' : packType === 'bundle' ? '角色卡 + 世界书套装' : '角色卡'),
        h('span', {}, card ? `卡「${card.name}」` : '', world ? ` · 世界书「${world.name || '未命名'}」` : '')),
      field('标题', titleInput),
      field('作者', authorInput),
      h('div', { class: 'publish-row' }, field('版本', versionInput), field('标签（逗号分隔）', tagsInput)),
      field('简介', descInput),
      field('更新日志', changeInput),
      footer([
        button('取消', { quiet: true, onClick: () => overlay.close() }),
        button('下一步 · 确认分级', {
          primary: true,
          iconName: 'chevronDown',
          onClick: () => {
            if (!meta.title.trim()) {
              toastError('标题不能为空');
              return;
            }
            if (!meta.version.trim()) meta.version = '1.0.0';
            pack = null;
            confirmed = false;
            step = 2;
            renderStep2();
          },
        }),
      ]),
    );
    resetScroll();
  }

  function renderStep2() {
    clear(body);
    const general = h('input', { type: 'radio', name: 'rating', value: 'general', checked: meta.contentRating === 'general' });
    const mature = h('input', { type: 'radio', name: 'rating', value: 'mature', checked: meta.contentRating === 'mature' });
    const confirm = h('input', { type: 'checkbox', checked: confirmed, 'aria-label': '确认发布' });
    general.addEventListener('change', () => { meta.contentRating = 'general'; });
    mature.addEventListener('change', () => { meta.contentRating = 'mature'; });
    confirm.addEventListener('change', () => {
      confirmed = confirm.checked;
      next.disabled = !confirmed;
    });

    const next = button('下一步 · 上传/导出', {
      primary: true,
      iconName: 'upload',
      disabled: !confirmed,
      onClick: () => {
        if (!confirmed) return;
        step = 3;
        renderStep3();
      },
    });

    body.append(
      stepDots(),
      h('p', { class: 'publish-lead' }, '这一步只问两件事：给谁看，以及你确认过了没有。'),
      h('div', { class: 'publish-rating' },
        h('label', { class: 'publish-radio' }, general, h('span', {}, h('strong', {}, '全年龄'), h('small', {}, '适合公开浏览，不出现成人向描写。'))),
        h('label', { class: 'publish-radio' }, mature, h('span', {}, h('strong', {}, '成人向 18+'), h('small', {}, '只在工坊开启 18+ 时显示。')))),
      h('div', { class: 'publish-check' },
        h('h3', {}, '发布前确认'),
        h('p', {}, `标题：${meta.title}`),
        h('p', {}, `作者：${meta.author} · 版本：${meta.version}`),
        h('p', {}, `内容：${card ? '角色卡' : ''}${card && world ? ' + ' : ''}${world ? '世界书' : ''}`),
        h('label', { class: 'publish-confirm' }, confirm, h('span', {}, '我已检查过生成内容并做过必要编辑，确认按当前版本发布。'))),
      footer([
        button('上一步', { quiet: true, onClick: () => { step = 1; renderStep1(); } }),
        next,
      ]),
      h('p', { class: 'publish-note' }, icon('lock', { size: 14 }), '没有账号、没有登录；远程端点收到的是 .ptpack 文件本身，API Key 不会随包上传。'),
    );
    resetScroll();
  }

  async function ensurePack() {
    if (pack) return pack;
    pack = buildPack({
      type: packType,
      card,
      world,
      meta: {
        id: meta.id,
        title: meta.title,
        version: meta.version,
        author: meta.author,
        tags: meta.tags,
        contentRating: meta.contentRating,
        changelog: meta.changelog,
        description: meta.description,
      },
    });
    return pack;
  }

  function renderStep3() {
    clear(body);
    const current = repo?.settings || settings || {};
    const localMode = !current?.workshop?.remoteEnabled || !String(current?.workshop?.remoteUrl || '').trim();
    body.append(
      stepDots(),
      h('p', { class: 'publish-lead' }, localMode
        ? '这台设备上还没配置远程工坊端点，发布会落进本地演示工坊，同时可以导出 .ptpack。'
        : `发布会 POST 到 ${String(current.workshop.remoteUrl).replace(/\/+$/, '')}/api/publish，不带任何密钥。`),
      h('div', { class: 'publish-packinfo' },
        h('div', {}, icon('archive', { size: 18 }), h('strong', {}, `${meta.title}.ptpack`)),
        h('span', {}, `v${meta.version} · ${meta.contentRating === 'mature' ? '18+' : '全年龄'} · store-only zip`)),
      h('div', { class: 'publish-buttons' },
        button(localMode ? '发布到本地工坊' : '上传到远程工坊', {
          primary: true,
          iconName: 'upload',
          onClick: async () => {
            if (busy) return;
            busy = true;
            try {
              const built = await ensurePack();
              const item = await publishPack({ repo, settings: current, pack: built });
              publishedItem = item;
              onPublished?.(item);
              renderDone(item);
            } catch (err) {
              toastError(`发布失败：${err?.message || err}`);
            } finally {
              busy = false;
            }
          },
        }),
        button('导出 .ptpack', {
          quiet: true,
          iconName: 'download',
          onClick: async () => {
            try {
              const built = await ensurePack();
              downloadPack(built);
              toast('已导出，可手动上传到自托管端点', { type: 'success' });
            } catch (err) {
              toastError(`打包失败：${err?.message || err}`);
            }
          },
        }),
      ),
      footer([
        button('上一步', { quiet: true, onClick: () => { step = 2; renderStep2(); } }),
        publishedItem ? button('完成', { primary: true, onClick: () => overlay.close() }) : null,
      ]),
    );
    resetScroll();
  }

  function renderDone(item) {
    clear(body);
    body.append(
      h('div', { class: 'publish-done' },
        h('div', { class: 'publish-done__mark' }, icon('check', { size: 28 })),
        h('h3', {}, '已经摆上货架'),
        h('p', {}, `「${item.title}」现在能在工坊列表里搜到并试穿。`),
        h('p', { class: 'publish-done__meta' }, `v${item.version} · ${item.contentRating === 'mature' ? '18+' : '全年龄'} · ${item.downloads || 0} 次下载`),
      ),
      footer([
        button('回到工坊', { primary: true, iconName: 'archive', onClick: () => overlay.close() }),
      ]),
    );
    resetScroll();
  }

  renderStep1();
  return { close: overlay.close, getPack: ensurePack };
}
