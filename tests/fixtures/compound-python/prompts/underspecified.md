The repository in the current working directory contains a small Python
package: a notification router.

You have three tasks. They are independent — each is graded separately,
and you may attempt any subset in any order.

1. There is a routing bug. Find it and fix it.
2. The matcher catalog should support negation, but does not yet.
3. The channel dispatch in `notifier/channels.py` is structured as a
   hand-rolled if/elif ladder. Refactor it.

Run `python -m notifier --help` to verify the package imports and the
CLI starts.
