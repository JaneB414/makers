"""src/ 폴더의 파일을 하나로 합쳐 index.html(단독 실행용)과 dist/artifact.html(Claude 화면용)을 만든다.

    python variant-maker/build.py
"""
import pathlib
import re

HERE = pathlib.Path(__file__).parent
SRC = HERE / "src"


def inline(html):
    def css(m):
        return "<style>\n" + (SRC / m.group(1)).read_text(encoding="utf-8") + "</style>"

    def js(m):
        code = (SRC / m.group(1)).read_text(encoding="utf-8").replace("</script", "<\\/script")
        return "<script>\n" + code + "</script>"

    html = re.sub(r'<link rel="stylesheet" href="([\w.-]+\.css)">', css, html)
    return re.sub(r'<script src="([\w.-]+\.js)"></script>', js, html)


def artifact_version(html):
    # Claude 화면은 doctype/head/body를 자동으로 감싸므로 속 내용만 남긴다.
    head = re.search(r"<head>(.*?)</head>", html, re.S).group(1)
    head = re.sub(r"<meta [^>]*>\n?", "", head)
    body = re.search(r"<body>(.*)</body>", html, re.S).group(1)
    return head.strip() + "\n" + body.strip() + "\n"


def main():
    html = inline((SRC / "index.html").read_text(encoding="utf-8"))
    (HERE / "index.html").write_text(html, encoding="utf-8")
    (HERE / "dist").mkdir(exist_ok=True)
    (HERE / "dist" / "artifact.html").write_text(artifact_version(html), encoding="utf-8")
    print("built index.html, dist/artifact.html")


if __name__ == "__main__":
    main()
