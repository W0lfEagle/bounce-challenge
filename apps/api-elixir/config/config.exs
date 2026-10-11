import Config

config :bounce, start_server: config_env() != :test
