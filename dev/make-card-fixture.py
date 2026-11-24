"""生成验收用 ccv2 PNG 角色卡（tEXt 关键字 chara，base64 JSON）。"""
import base64
import json
from pathlib import Path

from PIL import Image, ImageDraw, PngImagePlugin

HERE = Path(__file__).resolve().parent
OUT = HERE / "fixtures" / "test-ccv2.png"

card = {
    "spec": "chara_card_v2",
    "spec_version": "2.0",
    "data": {
        "name": "雨港的薇拉",
        "description": "在雾港开旧书铺的年轻店主，银发，右眼下有一颗小痣。说话慢，喜欢把客人称为「远道来的」。",
        "personality": "安静、敏锐、有点毒舌，但会默默记住别人随口提过的小事。",
        "scenario": "雾港下着连绵细雨的傍晚，旧书铺里只剩一盏黄灯。",
        "first_mes": "（她从一本摊开的航海日志上抬起眼，银发从肩头滑下来。）\n\n「远道来的。伞放门边就好——书怕潮，人也一样。」",
        "mes_example": "<START>\n{{user}}: 你这里有没有关于酒馆的书？\n{{char}}: 有。第三排最里面，《深夜营业指南》。不过借书的人回来时，通常已经不只想看书了。",
        "creator": "PocketTavern Test",
        "tags": ["测试", "雾港", "书商"],
        "system_prompt": "",
        "post_history_instructions": "",
        "alternate_greetings": [],
    },
}

b64 = base64.b64encode(json.dumps(card, ensure_ascii=False).encode("utf-8")).decode("ascii")

img = Image.new("RGB", (512, 768), (34, 27, 22))
draw = ImageDraw.Draw(img)
for y in range(768):
    t = y / 767
    draw.line((0, y, 512, y), fill=(int(34 + 30 * t), int(27 + 22 * t), int(22 + 14 * t)))
draw.ellipse((96, 120, 416, 440), fill=(58, 44, 30), outline=(232, 163, 61), width=4)
draw.ellipse((176, 200, 336, 360), fill=(210, 180, 146))
draw.rectangle((196, 360, 316, 470), fill=(58, 44, 30))
draw.text((124, 560), "TEST CARD  ccv2", fill=(239, 230, 218))
draw.text((124, 590), "vera of the mist harbor", fill=(168, 152, 138))

meta = PngImagePlugin.PngInfo()
meta.add_text("chara", b64)
OUT.parent.mkdir(parents=True, exist_ok=True)
img.save(OUT, "PNG", pnginfo=meta)
print(OUT)
print("bytes", OUT.stat().st_size, "b64", len(b64))
