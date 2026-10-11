defmodule Bounce.MixProject do
  use Mix.Project

  def project do
    [
      app: :bounce,
      version: "0.1.0",
      elixir: "~> 1.18",
      start_permanent: Mix.env() == :prod,
      deps: deps()
    ]
  end

  def application do
    [extra_applications: [:logger], mod: {Bounce.Application, []}]
  end

  defp deps do
    [
      {:bandit, "~> 1.12"},
      {:plug, "~> 1.20"},
      {:jason, "~> 1.4"},
      {:exqlite, "~> 0.42"},
      {:req, "~> 0.7"}
    ]
  end
end
