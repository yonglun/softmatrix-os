# This is the checked-in standalone profile template. A release build writes the complete
# immutable worker graph to <release>/runtime/workerd.capnp; this small config remains useful for
# validating the native persistent directories and socket override during installation checks.
using Workerd = import "/workerd/workerd.capnp";

const config :Workerd.Config = (
  services = [
    (name = "data", disk = (writable = true)),
    (name = "objects", disk = (writable = true)),
    (name = "softmatrix-assets", disk = (writable = false))
  ],
  sockets = [
    (name = "http", http = (), service = "softmatrix-assets")
  ]
);
