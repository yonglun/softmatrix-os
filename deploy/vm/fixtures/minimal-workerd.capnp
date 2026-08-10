using Workerd = import "/workerd/workerd.capnp";

const config :Workerd.Config = (
  services = [
    (name = "data", disk = (writable = true)),
    (name = "app", worker = (
      modules = [
        (name = "main", esModule = embed "counter.mjs")
      ],
      compatibilityDate = "2026-02-02",
      durableObjectNamespaces = [
        (className = "Counter", uniqueKey = "softmatrix-vm-smoke-counter", enableSql = true)
      ],
      durableObjectStorage = (localDisk = "data"),
      bindings = [
        (name = "COUNTER", durableObjectNamespace = "Counter")
      ]
    ))
  ],
  sockets = [
    (name = "http", service = "app", http = ())
  ],
  logging = (structuredLogging = true)
);
