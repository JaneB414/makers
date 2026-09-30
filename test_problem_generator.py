import unittest
from fractions import Fraction

import problem_generator as pg


class GenerateTest(unittest.TestCase):
    def test_every_type_and_level_produces_correct_answers(self):
        for kind in pg.GENERATORS:
            for level in (1, 2, 3):
                for p in pg.generate(kind, 50, level, seed=level):
                    self.assertIsInstance(p.answer, Fraction)
                    self.assertTrue(p.question)

    def test_arithmetic_answers_match_question(self):
        for kind in ("add", "sub", "mul", "div", "mixed"):
            for p in pg.generate(kind, 50, 2, seed=1):
                expr = p.question.split("=")[0].replace("×", "*").replace("÷", "/")
                self.assertEqual(Fraction(eval(expr)), p.answer, p.question)

    def test_subtraction_is_never_negative(self):
        for p in pg.generate("sub", 100, 3, seed=2):
            self.assertGreaterEqual(p.answer, 0)

    def test_equation_solution_satisfies_equation(self):
        for p in pg.generate("equation", 100, 3, seed=3):
            lhs, rhs = p.question.split(" 일 때")[0].split(" = ")
            x = p.answer
            self.assertEqual(eval(lhs.replace("x", f"*({x})")), int(rhs), p.question)

    def test_seed_is_reproducible(self):
        a = pg.generate("random", 20, 2, seed=42)
        b = pg.generate("random", 20, 2, seed=42)
        self.assertEqual(a, b)

    def test_invalid_level(self):
        with self.assertRaises(ValueError):
            pg.generate("add", 1, level=5)


class ParseAnswerTest(unittest.TestCase):
    def test_parse(self):
        self.assertEqual(pg.parse_answer(" 3 "), 3)
        self.assertEqual(pg.parse_answer("-2"), -2)
        self.assertEqual(pg.parse_answer("3/4"), Fraction(3, 4))
        self.assertEqual(pg.parse_answer("6/8"), Fraction(3, 4))
        self.assertEqual(pg.parse_answer("0.5"), Fraction(1, 2))
        self.assertIsNone(pg.parse_answer("abc"))
        self.assertIsNone(pg.parse_answer("1/0"))


class SheetTest(unittest.TestCase):
    def test_sheet_contains_questions_and_answers(self):
        problems = pg.generate("add", 3, seed=0)
        sheet = pg.render_sheet(problems)
        for p in problems:
            self.assertIn(p.question, sheet)
        self.assertIn("정답", sheet)


if __name__ == "__main__":
    unittest.main()
