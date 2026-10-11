defmodule Bounce.CheckoutError do
  defexception [:status, :code, :message, :store]

  def reject!(status, code, message, store \\ nil) do
    raise __MODULE__, status: status, code: code, message: message, store: store
  end
end
