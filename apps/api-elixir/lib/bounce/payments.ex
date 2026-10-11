defmodule Bounce.Payments do
  @timeout_ms 15_000

  def process(input) do
    task = Task.Supervisor.async_nolink(Bounce.PaymentTasks, fn -> request(input) end)

    case Task.yield(task, @timeout_ms) || Task.shutdown(task, :brutal_kill) do
      {:ok, result} -> result
      _ -> {:unknown, "PROVIDER_TIMEOUT"}
    end
  end

  defp request(input) do
    # Req normally retries some failures. A payment must never be retried automatically.
    case Req.post(Application.fetch_env!(:bounce, :payments_api_url),
           json: input,
           retry: false,
           redirect: false,
           decode_body: false,
           receive_timeout: @timeout_ms,
           connect_options: [timeout: @timeout_ms]
         ) do
      {:ok, %{status: status, body: body}} ->
        case Jason.decode(body) do
          {:ok, body} -> classify(status, body, input)
          _ -> {:unknown, "INVALID_PROVIDER_RESPONSE"}
        end

      {:error, _} ->
        {:unknown, "PROVIDER_NETWORK_ERROR"}
    end
  rescue
    _ -> {:unknown, "PROVIDER_REQUEST_FAILED"}
  end

  def classify(200, body, input) when is_map(body) do
    if transaction?(body) and body["amount"] == input.amount and
         body["currency"] == input.currency and
         body["last_four_digits"] == String.slice(input.card_number, -4, 4) do
      {:succeeded,
       Map.take(
         body,
         ~w(transaction_id status amount currency last_four_digits payment_method timestamp merchant_reference processing_fee)
       )}
    else
      {:unknown, "INVALID_PROVIDER_RESPONSE"}
    end
  end

  def classify(400, %{"detail" => %{} = detail}, input), do: classify(400, detail, input)

  def classify(400, %{"detail" => detail, "error_code" => code}, _input)
      when is_binary(detail) and is_binary(code) and byte_size(code) > 0, do: {:declined, code}

  def classify(422, %{"detail" => details}, _input) when is_list(details) do
    if Enum.all?(details, &validation_error?/1),
      do: {:declined, "PAYMENT_VALIDATION_FAILED"},
      else: {:unknown, "INVALID_PROVIDER_RESPONSE"}
  end

  def classify(status, _body, _input) when status in [200, 400, 422],
    do: {:unknown, "INVALID_PROVIDER_RESPONSE"}

  def classify(_status, _body, _input), do: {:unknown, "UNEXPECTED_PROVIDER_STATUS"}

  defp transaction?(body) do
    is_binary(body["transaction_id"]) and body["transaction_id"] != "" and
      body["status"] == "completed" and is_integer(body["amount"]) and body["amount"] > 0 and
      is_binary(body["currency"]) and is_binary(body["last_four_digits"]) and
      Regex.match?(~r/^[0-9]{4}$/, body["last_four_digits"]) and
      Enum.all?(["payment_method", "timestamp", "merchant_reference"], &is_binary(body[&1])) and
      is_integer(body["processing_fee"]) and body["processing_fee"] >= 0
  end

  defp validation_error?(%{"loc" => loc, "msg" => msg, "type" => type})
       when is_list(loc) and is_binary(msg) and is_binary(type),
       do: Enum.all?(loc, &(is_binary(&1) or is_number(&1)))

  defp validation_error?(_), do: false
end
