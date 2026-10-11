import Config

config :bounce,
  port: String.to_integer(System.get_env("PORT", "3001")),
  host: System.get_env("HOST", "127.0.0.1"),
  database_path: System.get_env("DATABASE_PATH", Path.expand("../data/bounce.sqlite", __DIR__)),
  web_origin: System.get_env("WEB_ORIGIN", "http://localhost:8081"),
  payments_api_url:
    System.get_env("PAYMENTS_API_URL", "https://fullstack-challenge-api.usebounce.io/v1/payments")
