# Component Contract

`style/component-contract.json` is the only source of shared component identity. Each family records a stable ID, category, approved status, exact/nine-slice/vector reuse mode, intrinsic size, scale policy, states, asset path/hash, text policy, source evidence, and locked properties. Strict mode rejects `local-generated` shared buttons, navigation, tabs, resource bars, and icons. Bindings refer to family ID and state; layouts refer to binding Slot IDs.

