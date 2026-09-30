"""수학 문제 생성기.

사용 예:
    python problem_generator.py                      # 대화형 메뉴
    python problem_generator.py quiz -t add -n 5      # 덧셈 5문제 풀기
    python problem_generator.py sheet -t mixed -n 20 -o 문제지.txt
"""

import argparse
import random
from dataclasses import dataclass
from fractions import Fraction


@dataclass
class Problem:
    question: str
    answer: Fraction

    def answer_text(self):
        return format_number(self.answer)


def format_number(value):
    value = Fraction(value)
    if value.denominator == 1:
        return str(value.numerator)
    return f"{value.numerator}/{value.denominator}"


# 난이도별 숫자 범위: (최소, 최대)
RANGES = {
    1: (1, 10),
    2: (10, 99),
    3: (100, 999),
}


def _num(rng, level):
    low, high = RANGES[level]
    return rng.randint(low, high)


def make_addition(rng, level):
    a, b = _num(rng, level), _num(rng, level)
    return Problem(f"{a} + {b} = ?", Fraction(a + b))


def make_subtraction(rng, level):
    a, b = _num(rng, level), _num(rng, level)
    a, b = max(a, b), min(a, b)  # 음수가 나오지 않도록
    return Problem(f"{a} - {b} = ?", Fraction(a - b))


def make_multiplication(rng, level):
    # 곱셈은 한쪽을 한 자리 수로 두어 난이도를 적당히 유지
    a = _num(rng, level)
    b = rng.randint(2, 9) if level > 1 else _num(rng, level)
    return Problem(f"{a} × {b} = ?", Fraction(a * b))


def make_division(rng, level):
    # 나누어떨어지는 문제만 만든다
    divisor = rng.randint(2, 9) if level < 3 else rng.randint(2, 19)
    quotient = _num(rng, level)
    return Problem(f"{divisor * quotient} ÷ {divisor} = ?", Fraction(quotient))


def make_mixed(rng, level):
    # a ○ b ○ c 형태, 연산 순서를 지켜야 한다
    a, b, c = (rng.randint(1, 10 * level) for _ in range(3))
    first, second = rng.choice("+-"), rng.choice("+-×")
    expr = f"{a} {first} {b} {second} {c}"
    answer = eval(expr.replace("×", "*"))
    return Problem(f"{expr} = ?", Fraction(answer))


def make_equation(rng, level):
    # ax + b = c 형태의 일차방정식, 해는 정수
    x = rng.randint(-10 * level, 10 * level)
    a = rng.choice([n for n in range(-3 * level, 3 * level + 1) if n not in (0, 1)])
    b = rng.randint(-20 * level, 20 * level)
    c = a * x + b
    sign = "+" if b >= 0 else "-"
    return Problem(f"{a}x {sign} {abs(b)} = {c} 일 때, x = ?", Fraction(x))


def make_fraction(rng, level):
    max_den = {1: 5, 2: 9, 3: 15}[level]
    f1 = Fraction(rng.randint(1, max_den), rng.randint(2, max_den))
    f2 = Fraction(rng.randint(1, max_den), rng.randint(2, max_den))
    op = rng.choice("+-")
    if op == "-" and f1 < f2:
        f1, f2 = f2, f1
    answer = f1 + f2 if op == "+" else f1 - f2
    return Problem(
        f"{format_number(f1)} {op} {format_number(f2)} = ? (기약분수로)", answer
    )


GENERATORS = {
    "add": ("덧셈", make_addition),
    "sub": ("뺄셈", make_subtraction),
    "mul": ("곱셈", make_multiplication),
    "div": ("나눗셈", make_division),
    "mixed": ("혼합 계산", make_mixed),
    "equation": ("일차방정식", make_equation),
    "fraction": ("분수 계산", make_fraction),
}


def generate(kind, count, level=1, seed=None):
    """문제 목록을 만든다. kind가 'random'이면 유형을 섞는다."""
    if level not in RANGES:
        raise ValueError(f"난이도는 1~3 사이여야 합니다: {level}")
    rng = random.Random(seed)
    problems = []
    for _ in range(count):
        k = rng.choice(list(GENERATORS)) if kind == "random" else kind
        problems.append(GENERATORS[k][1](rng, level))
    return problems


def parse_answer(text):
    """'3', '-2', '3/4', '0.5' 같은 입력을 Fraction으로 바꾼다. 실패하면 None."""
    try:
        return Fraction(text.strip().replace(" ", ""))
    except (ValueError, ZeroDivisionError):
        return None


def run_quiz(problems):
    correct = 0
    for i, p in enumerate(problems, 1):
        user = input(f"[{i}/{len(problems)}] {p.question} ")
        value = parse_answer(user)
        if value is not None and value == p.answer:
            print("  ⭕ 정답!")
            correct += 1
        else:
            print(f"  ❌ 오답. 정답은 {p.answer_text()}")
    score = round(correct / len(problems) * 100) if problems else 0
    print(f"\n결과: {len(problems)}문제 중 {correct}개 정답 ({score}점)")
    return correct


def render_sheet(problems, title="수학 문제지"):
    lines = [title, "=" * 30, ""]
    lines += [f"{i:>3}. {p.question}" for i, p in enumerate(problems, 1)]
    lines += ["", "-" * 30, "정답", "-" * 30]
    lines += [f"{i:>3}. {p.answer_text()}" for i, p in enumerate(problems, 1)]
    return "\n".join(lines) + "\n"


def interactive_menu():
    print("=== 문제 생성기 ===")
    keys = list(GENERATORS) + ["random"]
    for i, k in enumerate(keys, 1):
        name = GENERATORS[k][0] if k in GENERATORS else "무작위 섞기"
        print(f"  {i}. {name}")
    kind = keys[_ask_int("유형 번호: ", 1, len(keys)) - 1]
    level = _ask_int("난이도 (1~3): ", 1, 3)
    count = _ask_int("문제 수: ", 1, 100)
    mode = input("바로 풀기(q) / 문제지 출력(s) [q]: ").strip().lower()
    problems = generate(kind, count, level)
    if mode == "s":
        print()
        print(render_sheet(problems))
    else:
        print()
        run_quiz(problems)


def _ask_int(prompt, low, high):
    while True:
        text = input(prompt).strip()
        if text.isdigit() and low <= int(text) <= high:
            return int(text)
        print(f"  {low}~{high} 사이 숫자를 입력하세요.")


def main(argv=None):
    parser = argparse.ArgumentParser(description="수학 문제 생성기")
    sub = parser.add_subparsers(dest="mode")
    for mode, help_text in (("quiz", "문제를 바로 풀기"), ("sheet", "문제지 만들기")):
        p = sub.add_parser(mode, help=help_text)
        p.add_argument(
            "-t", "--type", default="random",
            choices=list(GENERATORS) + ["random"], help="문제 유형",
        )
        p.add_argument("-n", "--count", type=int, default=10, help="문제 수")
        p.add_argument("-l", "--level", type=int, default=1, choices=[1, 2, 3], help="난이도")
        p.add_argument("-s", "--seed", type=int, help="같은 문제를 다시 만들 때 쓰는 시드")
        if mode == "sheet":
            p.add_argument("-o", "--output", help="저장할 파일 경로 (없으면 화면 출력)")

    args = parser.parse_args(argv)
    if args.mode is None:
        interactive_menu()
        return

    problems = generate(args.type, args.count, args.level, args.seed)
    if args.mode == "quiz":
        run_quiz(problems)
    else:
        sheet = render_sheet(problems)
        if args.output:
            with open(args.output, "w", encoding="utf-8") as f:
                f.write(sheet)
            print(f"{args.output} 에 저장했습니다.")
        else:
            print(sheet, end="")


if __name__ == "__main__":
    try:
        main()
    except (KeyboardInterrupt, EOFError):
        print("\n종료합니다.")
