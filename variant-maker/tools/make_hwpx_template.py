"""HWPX 빈 문서 틀(src/hwpx-template.js)을 만든다.

python-hwpx(Apache-2.0) 패키지에 들어 있는 Skeleton.hwpx를 바탕으로, 시험지 디자인(시안 A)에
필요한 글꼴·글자 모양·문단 모양·테두리를 추가한다.

    pip download python-hwpx --no-deps -d /tmp/hw
    python variant-maker/tools/make_hwpx_template.py /tmp/hw/python_hwpx-*.whl
"""
import json
import pathlib
import re
import sys
import zipfile
import io

OUT = pathlib.Path(__file__).resolve().parent.parent / "src" / "hwpx-template.js"

NAVY = "#1D3A6B"
GRAY = "#6B7688"
FOOT_GRAY = "#555555"
BOX_FILL = "#EEF2F8"
RULE = "#C9D1DE"

# 본문 폭: A4(59528) - 좌우 여백 15mm(4252)씩
BODY_WIDTH = 59528 - 4252 * 2
ASK_INDENT = 2000  # 문항 번호 뒤 발문이 시작하는 위치


def load_skeleton(wheel):
    with zipfile.ZipFile(wheel) as whl:
        data = whl.read("hwpx/data/Skeleton.hwpx")
    with zipfile.ZipFile(io.BytesIO(data)) as sk:
        return {n: sk.read(n).decode("utf-8") for n in sk.namelist() if not n.endswith(".png")}


def add_items(xml, tag, items):
    count = int(re.search(r'<hh:%s itemCnt="(\d+)"' % tag, xml).group(1))
    xml = xml.replace("</hh:%s>" % tag, "".join(items) + "</hh:%s>" % tag, 1)
    return xml.replace('<hh:%s itemCnt="%d"' % (tag, count), '<hh:%s itemCnt="%d"' % (tag, count + len(items)), 1)


def add_font(xml, lang, face, family):
    block = re.search(r'<hh:fontface lang="%s" fontCnt="(\d+)">(.*?)</hh:fontface>' % lang, xml, re.S)
    n = int(block.group(1))
    type_info = re.search(r"<hh:typeInfo[^>]*/>", block.group(2)).group(0).replace('familyType="FCAT_GOTHIC"', 'familyType="%s"' % family)
    font = '<hh:font id="%d" face="%s" type="TTF" isEmbedded="0">%s</hh:font>' % (n, face, type_info)
    new = '<hh:fontface lang="%s" fontCnt="%d">%s%s</hh:fontface>' % (lang, n + 1, block.group(2), font)
    return xml.replace(block.group(0), new), n


def main(wheel):
    files = load_skeleton(wheel)
    h = files["Contents/header.xml"]

    # 글꼴: 한글은 함초롬돋움(0)·함초롬바탕(1), 영어는 Times New Roman
    h, tnr = add_font(h, "LATIN", "Times New Roman", "FCAT_MYUNGJO")
    DOTUM, BATANG = 0, 1

    cp0 = re.search(r'<hh:charPr id="0".*?</hh:charPr>', h, re.S).group(0)
    next_char = int(re.search(r'<hh:charProperties itemCnt="(\d+)"', h).group(1))
    char_ids, char_items = {}, []

    def char(name, pt, hangul, bold=False, underline=False, color="#000000", latin=None):
        nonlocal next_char
        latin = tnr if latin is None else latin
        s = cp0.replace('id="0"', 'id="%d"' % next_char, 1)
        s = s.replace('height="1000"', 'height="%d"' % round(pt * 100), 1)
        s = s.replace('textColor="#000000"', 'textColor="%s"' % color, 1)
        s = re.sub(r"<hh:fontRef [^>]*/>",
                   '<hh:fontRef hangul="%d" latin="%d" hanja="%d" japanese="%d" other="%d" symbol="%d" user="%d"/>'
                   % (hangul, latin, hangul, hangul, hangul, hangul, hangul), s, 1)
        if bold:
            s = s.replace("<hh:underline", "<hh:bold/><hh:underline", 1)
        if underline:
            s = s.replace('<hh:underline type="NONE" shape="SOLID" color="#000000"/>',
                          '<hh:underline type="BOTTOM" shape="SOLID" color="%s"/>' % color, 1)
        char_ids[name] = next_char
        char_items.append(s)
        next_char += 1

    for suffix, b, u in (("", False, False), ("U", False, True), ("B", True, False), ("BU", True, True)):
        char("body" + suffix, 10, BATANG, b, u)
        char("ask" + suffix, 10, DOTUM, True, u)
    char("num", 13, BATANG, bold=True, color=NAVY)
    char("src", 8, DOTUM, bold=True, color=GRAY)
    char("title", 18, BATANG, bold=True)
    char("eyebrow", 8.5, DOTUM, bold=True, color=NAVY)
    char("name", 9, DOTUM)
    char("hf", 8, DOTUM, color=FOOT_GRAY)
    char("ansTitle", 14, BATANG, bold=True)
    char("ansNum", 9.5, BATANG, bold=True, color=NAVY)
    char("ans", 9.5, BATANG)
    char("ansU", 9.5, BATANG, underline=True)
    char("ansB", 9.5, BATANG, bold=True)
    char("explain", 8.5, BATANG, color="#444444")
    char("explainU", 8.5, BATANG, underline=True, color="#444444")
    h = add_items(h, "charProperties", char_items)

    # 테두리/배경
    bf2 = re.search(r'<hh:borderFill id="2".*?</hh:borderFill>', h, re.S).group(0)
    next_bf = int(re.search(r'<hh:borderFills itemCnt="(\d+)"', h).group(1)) + 1
    bf_ids, bf_items = {}, []

    def border_fill(name, sides=None, fill=None):
        nonlocal next_bf
        s = bf2.replace('id="2"', 'id="%d"' % next_bf, 1)
        for side, (kind, width, color) in (sides or {}).items():
            s = s.replace('<hh:%sBorder type="NONE" width="0.1 mm" color="#000000"/>' % side,
                          '<hh:%sBorder type="%s" width="%s" color="%s"/>' % (side, kind, width, color), 1)
        if fill:
            s = s.replace('<hc:winBrush faceColor="none" hatchColor="#999999" alpha="0"/>',
                          '<hc:winBrush faceColor="%s" hatchColor="#999999" alpha="0"/>' % fill, 1)
        bf_ids[name] = next_bf
        bf_items.append(s)
        next_bf += 1

    border_fill("box", fill=BOX_FILL)
    border_fill("headRule", {"bottom": ("SOLID", "0.7 mm", NAVY)})
    border_fill("footRule", {"top": ("SOLID", "0.12 mm", NAVY)})
    border_fill("headerRule", {"bottom": ("SOLID", "0.12 mm", "#999999")})
    h = add_items(h, "borderFills", bf_items)

    # 탭: 발문 들여쓰기용(왼쪽 탭), 머리말·꼬리말용(가운데·오른쪽 탭)
    next_tab = int(re.search(r'<hh:tabProperties itemCnt="(\d+)"', h).group(1))
    tab_ids, tab_items = {}, []

    def tab(name, stops):
        nonlocal next_tab
        body = "".join(
            '<hp:switch><hp:case hp:required-namespace="http://www.hancom.co.kr/hwpml/2016/HwpUnitChar">'
            '<hh:tabItem pos="%d" type="%s" leader="NONE" unit="HWPUNIT"/></hp:case>'
            '<hp:default><hh:tabItem pos="%d" type="%s" leader="NONE"/></hp:default></hp:switch>' % (pos, kind, pos * 2, kind)
            for pos, kind in stops)
        tab_items.append('<hh:tabPr id="%d" autoTabLeft="0" autoTabRight="0">%s</hh:tabPr>' % (next_tab, body))
        tab_ids[name] = next_tab
        next_tab += 1

    tab("ask", [(ASK_INDENT, "LEFT")])
    tab("hf", [(BODY_WIDTH // 2, "CENTER"), (BODY_WIDTH, "RIGHT")])
    h = add_items(h, "tabProperties", tab_items)

    # 문단 모양
    pp0 = re.search(r'<hh:paraPr id="0".*?</hh:paraPr>', h, re.S).group(0)
    next_para = int(re.search(r'<hh:paraProperties itemCnt="(\d+)"', h).group(1))
    para_ids, para_items = {}, []

    def para(name, align="JUSTIFY", left=0, indent=0, prev=0, after=0, line=160, border=None, offsets=(0, 0, 0, 0), tab_id=0, keep_next=False):
        nonlocal next_para
        s = pp0.replace('<hh:paraPr id="0" tabPrIDRef="0"', '<hh:paraPr id="%d" tabPrIDRef="%d"' % (next_para, tab_id), 1)
        s = s.replace('horizontal="JUSTIFY"', 'horizontal="%s"' % align, 1)
        if keep_next:
            s = s.replace('keepWithNext="0"', 'keepWithNext="1"', 1)
        case, default = re.search(r"(<hp:case .*?</hp:case>)(<hp:default>.*?</hp:default>)", s, re.S).groups()

        def fill(block, k):
            for key, value in (("intent", indent), ("left", left), ("prev", prev), ("next", after)):
                block = block.replace('<hc:%s value="0" unit="HWPUNIT"/>' % key, '<hc:%s value="%d" unit="HWPUNIT"/>' % (key, value * k), 1)
            return block.replace('<hh:lineSpacing type="PERCENT" value="160" unit="HWPUNIT"/>',
                                 '<hh:lineSpacing type="PERCENT" value="%d" unit="HWPUNIT"/>' % line, 1)

        s = s.replace(case, fill(case, 1), 1).replace(default, fill(default, 2), 1)
        if border:
            l, r, t, b = offsets
            s = s.replace('<hh:border borderFillIDRef="2" offsetLeft="0" offsetRight="0" offsetTop="0" offsetBottom="0" connect="0"',
                          '<hh:border borderFillIDRef="%d" offsetLeft="%d" offsetRight="%d" offsetTop="%d" offsetBottom="%d" connect="1"'
                          % (bf_ids[border], l, r, t, b), 1)
        para_ids[name] = next_para
        para_items.append(s)
        next_para += 1

    para("body", line=165)
    para("box", left=350, line=160, prev=150, after=150, border="box", offsets=(350, 350, 250, 250))
    para("choice", left=1100, indent=-1100, line=155)
    para("src", align="LEFT", left=ASK_INDENT, prev=1100, line=120, keep_next=True)
    para("ask", align="LEFT", left=ASK_INDENT, indent=-ASK_INDENT, after=300, line=150, tab_id=tab_ids["ask"], keep_next=True)
    para("askFirst", align="LEFT", left=ASK_INDENT, indent=-ASK_INDENT, prev=1100, after=300, line=150, tab_id=tab_ids["ask"], keep_next=True)
    para("eyebrow", align="LEFT", line=130)
    para("title", align="LEFT", line=130)
    para("nameLine", align="RIGHT", line=130, after=900, border="headRule", offsets=(0, 0, 0, 450))
    para("header", align="LEFT", line=120, border="headerRule", offsets=(0, 0, 0, 200), tab_id=tab_ids["hf"])
    para("footer", align="LEFT", line=120, border="footRule", offsets=(0, 0, 250, 0), tab_id=tab_ids["hf"])
    para("ansTitle", align="CENTER", after=500, line=130)
    para("ans", align="LEFT", left=1300, indent=-1300, line=145, after=100)
    para("answerLine", align="LEFT", left=ASK_INDENT, prev=200, line=150)
    h = add_items(h, "paraProperties", para_items)
    files["Contents/header.xml"] = h

    # 본문 조각: 첫 문단(쪽 설정 포함)과 단 설정
    sec = files["Contents/section0.xml"]
    first = re.search(r'(<hp:p id="0".*?)<hp:ctrl><hp:colPr[^>]*/></hp:ctrl></hp:run>', sec, re.S).group(1)
    first = first.replace('<hp:margin header="4252" footer="4252" gutter="0" left="8504" right="8504" top="5668" bottom="4252"/>',
                          '<hp:margin header="2835" footer="2835" gutter="0" left="4252" right="4252" top="2835" bottom="2835"/>')
    assert 'left="4252"' in first
    files["__secHead"] = sec[: sec.index("<hp:p ")]
    files["__firstPara"] = first  # 여는 <hp:p> … 첫 <hp:run>의 secPr까지. 뒤에 단 설정과 머리말·꼬리말을 붙인다.
    files["__colRule"] = RULE
    files["__bodyWidth"] = BODY_WIDTH
    files["__style"] = {"char": char_ids, "para": para_ids}

    js = ("// 한글(HWPX) 빈 문서 틀. tools/make_hwpx_template.py로 만든다.\n"
          "// python-hwpx(Apache-2.0)의 Skeleton.hwpx에 시험지 디자인용 글자·문단 모양을 추가한 것이다.\n"
          "var HWPX_TEMPLATE = " + json.dumps(files, ensure_ascii=False) + ";\n"
          'if (typeof module !== "undefined") module.exports = HWPX_TEMPLATE;\n')
    OUT.write_text(js, encoding="utf-8")
    print("wrote", OUT, "chars", char_ids, "paras", para_ids)


if __name__ == "__main__":
    main(sys.argv[1])
