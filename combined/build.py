"""변형문제 메이커와 워크북 메이커를 탭 두 개로 묶은 '영어 메이커' 페이지(dist/artifact.html)를 만든다.

Claude 화면의 페이지는 페이지마다 저장소가 따로라서, 두 메이커가 지문 보관함을 함께 쓰려면 한 페이지에 있어야 한다.
각 메이커의 단독 실행용 index.html을 그대로 iframe(srcdoc)에 넣고, Claude 화면 기능을 빌려 쓰는 다리(bridge.js)를 끼운다.

    python combined/build.py
"""
import json
import pathlib
import subprocess
import sys

HERE = pathlib.Path(__file__).parent
ROOT = HERE.parent


def app_doc(name):
    html = (ROOT / name / "index.html").read_text(encoding="utf-8")
    bridge = (HERE / "src" / "bridge.js").read_text(encoding="utf-8")
    # 다리는 앱 스크립트보다 먼저 돌아야 하므로 <head> 바로 뒤에 넣는다.
    assert html.count("<head>") == 1
    return html.replace("<head>", "<head>\n<script>\n" + bridge + "</script>", 1)


def main():
    for name in ("variant-maker", "workbook-maker"):
        subprocess.run([sys.executable, str(ROOT / name / "build.py")], check=True)
    docs = {"variant": app_doc("variant-maker"), "workbook": app_doc("workbook-maker")}
    data = json.dumps(docs, ensure_ascii=False).replace("</", "<\\/")
    shell = (HERE / "src" / "shell.html").read_text(encoding="utf-8")
    assert shell.count("/*DOCS*/{}") == 1
    (HERE / "dist").mkdir(exist_ok=True)
    (HERE / "dist" / "artifact.html").write_text(shell.replace("/*DOCS*/{}", data), encoding="utf-8")
    print("built combined/dist/artifact.html")


if __name__ == "__main__":
    main()
