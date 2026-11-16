---
"@goodfellow-cms/core": patch
"@goodfellow-cms/broker": patch
---

The token broker refuses any call it makes unasked with more arguments than its policy lists, so an extra argument to `filesAt()` can no longer move its method's path out of the place checked as a path. `serveBackend()` makes a factory's call, such as `filesAt(revision).read(path)`, with the arguments its check gives back, for the factory and its method alike, and refuses one whose factory isn't given exactly its own arguments, whose method's arguments aren't a list, or whose check gives back another number of arguments, so each argument is used where it was checked.
