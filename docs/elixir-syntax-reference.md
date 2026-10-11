# Elixir syntax beside our Node code

Use this while reading the [porting tutorial](node-to-elixir.md). These small examples explain syntax used in the port; the linked modules contain the complete implementation.

| Familiar JavaScript / TypeScript | Elixir | Example in our port |
| --- | --- | --- |
| Module exports | `defmodule`, public `def`, private `defp` | [Stores](../apps/api-elixir/lib/bounce/stores.ex) |
| `import …` with a short name | `alias Bounce.Database, as: DB` | [Stores](../apps/api-elixir/lib/bounce/stores.ex) |
| Object with known keys | `%{amount: 590}` (atom keys) | [Checkout](../apps/api-elixir/lib/bounce/checkout.ex) |
| Parsed JSON object | `%{"amount" => 590}` (string keys) | [Contracts](../apps/api-elixir/lib/bounce/contracts.ex) |
| `{ ...object, status }` | `Map.put(object, "status", status)` | [Stores](../apps/api-elixir/lib/bounce/stores.ex) |
| Array | `[item]`; linked-list operations via `Enum` | [Bookings](../apps/api-elixir/lib/bounce/bookings.ex) |
| Discriminated union value | `{:succeeded, transaction}` tagged tuple | [Payments](../apps/api-elixir/lib/bounce/payments.ex) |
| `if (result.status === …)` | `case result do … end` matching shapes | [Bookings](../apps/api-elixir/lib/bounce/bookings.ex) |
| Ordered `if / else if` | `cond do condition -> value … end` | [Checkout](../apps/api-elixir/lib/bounce/checkout.ex) |
| `items.map(item => …)` | `Enum.map(items, fn item -> … end)` | [Bookings](../apps/api-elixir/lib/bounce/bookings.ex) |
| Arrow callback | `fn input -> … end` or `&function/1` | [Checkout tests](../apps/api-elixir/test/checkout_test.exs) |
| `callback(input)` | `callback.(input)` for anonymous functions | [Checkout](../apps/api-elixir/lib/bounce/checkout.ex) |
| Default argument | `pay \\ &Payments.process/1` | [Checkout](../apps/api-elixir/lib/bounce/checkout.ex) |
| Function chaining | `value |> first() |> second()` | [Router](../apps/api-elixir/lib/bounce/router.ex) |
| Throw/catch | `raise` and `try … rescue … end` | [CheckoutError](../apps/api-elixir/lib/bounce/checkout_error.ex) |
| Cleanup `finally` | `after` in `try` | [Database](../apps/api-elixir/lib/bounce/database.ex) |
| Runtime environment | `System.get_env("PORT", "3001")` | [Runtime config](../apps/api-elixir/config/runtime.exs) |
| npm package configuration | `mix.exs` and `mix.lock` | [Mix project](../apps/api-elixir/mix.exs) |

## Read a capture

```elixir
Database.transaction(database, &Bookings.finish(&1, data, result))
```

This passes a function taking one argument, `db`, and calling `Bookings.finish(db, data, result)`. It closes over `data` and `result`. The expanded form is:

```elixir
Database.transaction(database, fn db ->
  Bookings.finish(db, data, result)
end)
```

## Read a match

```elixir
{:ok, db} = Exqlite.Sqlite3.open(":memory:")
[item] = store["checkoutItems"]
```

The first line expects a success tuple. The second expects a one-element list. Both raise if their expected shape is absent. Public invalid input uses an explicit error result instead of these assertions.

```elixir
expected = "USD"
%{"currency" => ^expected} = %{"currency" => "USD"}
```

The pin `^expected` matches the current value instead of binding a new one. See [pattern matching](https://hexdocs.pm/elixir/pattern-matching.html).

## Read defaults, attributes, and callbacks

```elixir
@timeout_ms 15_000
@impl true
def handle_call({:run, operation}, _from, db) do
  # ...
end
```

`@timeout_ms` is a module attribute, and underscores make numeric literals readable. `@impl true` marks a behavior callback. `_from` names an intentionally unused parameter; `_` completely discards a value. A function name plus arity, such as `handle_call/3`, identifies its three-argument form.

Functions ending in `?` conventionally answer a predicate (`uuid?`). Functions ending in `!` conventionally raise on failure (`File.read!`). These are naming conventions, not extra operators. `@spec` can document function types for tooling, but it does not perform input validation. See [typespecs](https://hexdocs.pm/elixir/typespecs.html).

## Common translation traps

- Only `false` and `nil` are falsy. Empty strings, empty lists, and zero are truthy.
- `and` / `or` expect boolean left operands; `&&` / `||` also support truthy values. The checkout uses `booking && …` because a booking is a map or `nil`.
- `"status"` and `:status` are different keys. JSON input uses strings; validated internal data uses a fixed set of atom keys.
- `/` returns a float; use `div/2` for integer division. Prices stay in integer cents.
- `=` is matching/binding; `==` compares values, while `===` also distinguishes numeric types.
- Data is immutable, but a variable name can be rebound. `Map.put` returns a new map.
- A pipe passes data to the next function's first argument. It does not start concurrent work.
- `use` invokes a module's setup macro. Ordinary business modules do not become processes merely because they are modules.
- Sending a process message and awaiting a response does not make the operation durable. SQL persistence remains essential for booking recovery.

Continue with the official [language introduction](https://hexdocs.pm/elixir/introduction.html), [anonymous functions](https://hexdocs.pm/elixir/anonymous-functions.html), and [GenServer](https://hexdocs.pm/elixir/GenServer.html) guides.
