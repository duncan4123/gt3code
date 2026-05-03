#!/bin/bash
set -euo pipefail

echo "=== Checkout Persist Failure Repro ==="
cc -g -I. -I../src -o doltlite_regression_test_c \
  ../test/doltlite_regression_test_c.c libdoltlite.a -lz -lpthread -lm
./doltlite_regression_test_c checkout_persist_failure
