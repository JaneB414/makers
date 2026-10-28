"""src/ 폴더의 파일(과 함께 쓰는 변형문제 메이커 파일)을 하나로 합쳐
index.html(단독 실행용)과 dist/artifact.html(Claude 화면용)을 만든다.

    python workbook-maker/build.py
"""
import pathlib
import re

HERE = pathlib.Path(__file__).parent
SRC = HERE / "src"


def read(rel):
    return (SRC / rel).resolve().read_text(encoding="utf-8")


def inline(html):
    def css(m):
        return "<style>\n" + read(m.group(1)) + "</style>"

    def js(m):
        return "<script>\n" + read(m.group(1)).replace("</script", "<\\/script") + "</script>"

    html = re.sub(r'<link rel="stylesheet" href="([\w./-]+\.css)">', css, html)
    return re.sub(r'<script src="([\w./-]+\.js)"></script>', js, html)


def artifact_version(html):
    # Claude 화면은 doctype/head/body를 자동으로 감싸므로 속 내용만 남긴다.
    head = re.search(r"<head>(.*?)</head>", html, re.S).group(1)
    head = re.sub(r"<meta [^>]*>\n?", "", head)
    body = re.search(r"<body>(.*)</body>", html, re.S).group(1)
    return head.strip() + "\n" + body.strip() + "\n"


def main():
    html = inline(read("index.html"))
    (HERE / "index.html").write_text(html, encoding="utf-8")
    (HERE / "dist").mkdir(exist_ok=True)
    (HERE / "dist" / "artifact.html").write_text(artifact_version(html), encoding="utf-8")
    print("built index.html, dist/artifact.html")


if __name__ == "__main__":
    main()
