# makers

- [`variant-maker/`](variant-maker/): 영어 변형문제 메이커. 지문으로 모의고사 유형 변형문제를 만들어 HWPX·PDF로 저장합니다.
- `problem_generator.py`: 수학 문제 생성기 (아래 설명)

## 수학 문제 생성기

수학 문제를 무작위로 만들어 주는 파이썬 프로그램입니다. 설치할 패키지는 없고 Python 3.8 이상만 있으면 됩니다.

### 문제 유형

| 옵션 | 유형 | 예시 |
|------|------|------|
| `add` | 덧셈 | `7 + 5 = ?` |
| `sub` | 뺄셈 (답이 음수가 되지 않음) | `12 - 4 = ?` |
| `mul` | 곱셈 | `23 × 7 = ?` |
| `div` | 나눗셈 (나누어떨어짐) | `56 ÷ 8 = ?` |
| `mixed` | 혼합 계산 (연산 순서) | `3 + 4 × 2 = ?` |
| `equation` | 일차방정식 | `3x - 5 = 10 일 때, x = ?` |
| `fraction` | 분수 덧셈·뺄셈 | `1/2 + 1/3 = ?` |
| `random` | 위 유형을 섞어서 | |

난이도는 `1`(한 자리), `2`(두 자리), `3`(세 자리)입니다.

### 사용법

```bash
# 메뉴에서 골라서 하기
python problem_generator.py

# 바로 풀기: 곱셈 5문제, 난이도 2
python problem_generator.py quiz -t mul -n 5 -l 2

# 문제지 + 정답지를 파일로 저장
python problem_generator.py sheet -t random -n 20 -o 문제지.txt

# 같은 시드를 주면 같은 문제가 다시 나옴
python problem_generator.py sheet -n 10 -s 42
```

답은 `3`, `-2`, `3/4`, `0.75` 같은 형식으로 입력할 수 있습니다. 분수는 약분하지 않아도 같은 값이면 정답으로 처리됩니다.

### 새 유형 추가하기

`(rng, level)`을 받아 `Problem(question, answer)`를 돌려주는 함수를 만들고 `GENERATORS`에 등록하면 됩니다.

### 테스트

```bash
python -m unittest
```
