defmodule Bounce.Contracts do
  @moduledoc "Runtime validation at the JSON boundary; mirrors packages/contracts."
  @uuid ~r/^(?:[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$/i
  @store_id ~r/^[a-z0-9]+(?:-[a-z0-9]+)*$/
  @email ~r/^(?!\.)(?!.*\.\.)([A-Za-z0-9_'+\-\.]*)[A-Za-z0-9_+\-]@([A-Za-z0-9][A-Za-z0-9\-]*\.)+[A-Za-z]{2,}$/

  def uuid?(value), do: is_binary(value) and Regex.match?(@uuid, value)

  def store_id?(value),
    do: is_binary(value) and byte_size(value) in 1..100 and Regex.match?(@store_id, value)

  def checkout(%{
        "checkoutId" => checkout_id,
        "attemptId" => attempt_id,
        "storeId" => store_id,
        "items" => [%{"itemId" => "bag", "quantity" => quantity}],
        "expectedTotalCents" => total,
        "currency" => currency,
        "name" => name,
        "email" => email,
        "cardNumber" => card
      })
      when is_binary(name) and is_binary(email) and is_binary(card) and is_binary(currency) do
    name = String.trim(name)
    email = String.trim(email)
    digits = String.replace(card, " ", "")

    if uuid?(checkout_id) and uuid?(attempt_id) and store_id?(store_id) and
         safe_positive_integer?(quantity) and safe_positive_integer?(total) and
         Regex.match?(~r/^[A-Z]{3}$/, currency) and name != "" and Regex.match?(@email, email) and
         Regex.match?(~r/^[0-9 ]+$/, card) and Regex.match?(~r/^[0-9]{13,19}$/, digits) do
      {:ok,
       %{
         checkout_id: checkout_id,
         attempt_id: attempt_id,
         store_id: store_id,
         items: [%{"itemId" => "bag", "quantity" => quantity}],
         quantity: quantity,
         expected_total_cents: total,
         currency: currency,
         name: name,
         email: email,
         card_number: digits
       }}
    else
      {:error, :invalid_checkout}
    end
  end

  def checkout(_), do: {:error, :invalid_checkout}

  defp safe_positive_integer?(value),
    do: is_integer(value) and value > 0 and value <= 9_007_199_254_740_991
end
