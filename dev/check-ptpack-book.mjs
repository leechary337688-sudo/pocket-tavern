const { buildPack, parsePackBytes } = await import('../src/workshop/packer.js');

const card = {
  id: 'card-ptpack-test',
  name: '持书人',
  description: '背包里总有一本会自己翻页的书。',
  personality: '谨慎，话少。',
  scenario: '旧书店打烊之后。',
  first_mes: '「别碰第三排那本。」',
  mes_example: '',
  tags: ['书', '测试'],
  avatar: '',
  spec: 'chara_card_v2',
  character_book: {
    name: '持书人的私藏',
    entries: [{
      uid: 'cb-1',
      key: ['第三排'],
      keysecondary: [],
      comment: '禁书',
      content: '第三排的书会记住翻开它的人。',
      position: 'before',
      order: 10,
      tokenBudget: 0,
      recursive: false,
      selective: false,
      constant: false,
      probability: 100,
      caseSensitive: false,
      useRegex: false,
      enabled: true,
    }],
  },
};

const pack = buildPack({ type: 'card', card, meta: { id: 'ptpack-book-test', version: '1.0.0', author: 'tester', tags: ['测试'], contentRating: 'general', changelog: 'test' } });
const parsed = parsePackBytes(pack.zip);
const entries = parsed?.card?.character_book?.entries || [];
const ok = parsed?.manifest?.type === 'card'
  && parsed?.card?.name === '持书人'
  && parsed?.card?.character_book?.name === '持书人的私藏'
  && entries.length === 1
  && entries[0].key?.[0] === '第三排'
  && /记住翻开它的人/.test(entries[0].content || '');

console.log(JSON.stringify({
  size: pack.size,
  manifestType: parsed?.manifest?.type,
  bookName: parsed?.card?.character_book?.name,
  entries: entries.length,
  key: entries[0]?.key,
}, null, 2));
console.log(ok ? 'PTPACK BOOK OK' : 'PTPACK BOOK FAILED');
process.exit(ok ? 0 : 1);
