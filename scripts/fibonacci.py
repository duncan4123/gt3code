"""Utility helpers for working with the Fibonacci sequence.

This script intentionally keeps the implementation dependency free so it can
be executed in any environment that already has Python installed (which is the
case for the build machines used in this repository).
"""

from __future__ import annotations

import argparse
from typing import Iterator


def fibonacci(n: int) -> int:
    """Return the *n*th Fibonacci number (0-indexed).

    Raises:
        TypeError: If ``n`` is not an integer.
        ValueError: If ``n`` is negative.
    """

    if not isinstance(n, int):
        raise TypeError("n must be an integer")
    if n < 0:
        raise ValueError("n must be non-negative")
    if n < 2:
        return n

    prev, curr = 0, 1
    for _ in range(2, n + 1):
        prev, curr = curr, prev + curr
    return curr


def fibonacci_sequence(length: int) -> Iterator[int]:
    """Yield a Fibonacci sequence of ``length`` terms."""

    if not isinstance(length, int):
        raise TypeError("length must be an integer")
    if length < 0:
        raise ValueError("length must be non-negative")

    for index in range(length):
        yield fibonacci(index)


def main() -> None:
    parser = argparse.ArgumentParser(description="Compute Fibonacci numbers")
    parser.add_argument(
        "n",
        type=int,
        help="Fibonacci index to compute (0-indexed)",
    )
    parser.add_argument(
        "--sequence",
        action="store_true",
        help="Print the Fibonacci sequence up to the requested index",
    )
    args = parser.parse_args()

    if args.sequence:
        print(" ".join(str(value) for value in fibonacci_sequence(args.n + 1)))
    else:
        print(fibonacci(args.n))


if __name__ == "__main__":
    main()
