# Softmatrix OS 模型治理

Softmatrix OS 的多 LLM 支持分为部署托管模型和个人模型两类。模型目录中的名称、提供商、启用状态和默认状态可以通过 RPC 返回；API token、Cloudflare account ID 以及其它凭据只存在于后端运行时，永远不会返回到浏览器、日志或发布清单。

## 部署密钥

将组织模型配置为一个 JSON 数组，并通过 Cloudflare Workers Secret 注入：

```json
[
  {
    "id": "org-claude",
    "name": "Company Claude",
    "provider": "anthropic",
    "model": "claude-sonnet-5",
    "contextWindow": 1000000,
    "apiToken": "<stored only as the ORG_AI_MODELS secret>"
  }
]
```

支持的 `provider` 为 `openai`、`anthropic`、`google`、`cloudflare` 和 `ollama`。除 Ollama 外必须提供 `apiToken`；Workers AI (`cloudflare`) 还必须提供 `accountId`。`apiUrl` 必须使用 HTTPS；只有本地 `DEV` 环境允许 HTTP。第一阶段最多 20 个模型，JSON 最大 5 KiB，模型 ID 必须唯一。

```sh
wrangler secret put ORG_AI_MODELS
```

个人模型凭据是否允许由部署变量控制。未设置时为 `true`，保持旧部署兼容；设置为字符串 `false` 时，用户不能新增或使用个人 BYOK 模型，但仍可以删除已保存的个人模型：

```sh
wrangler secret put ALLOW_USER_BYOK
# 输入 false 以关闭个人 BYOK
```

`ALLOW_USER_BYOK` 是部署硬策略，不由管理员会话修改。管理员页面只显示说明；组织模型的启用和默认选择存储在非敏感 `AdminConfig` 中。

## 管理与故障处理

管理员在 Admin → Models 中启用/停用组织模型并选择默认模型。停用当前默认模型时，服务端先清空默认值，再写入停用状态。用户的显式模型选择不会在凭据、限流、余额或服务商故障时静默切换；界面保留失败模型，并提供重试和切换操作。

新增个人模型前会执行一次有 10 秒上限、最多一个输出 token 的连接测试。测试结果只包含稳定错误码和关联 ID：`MODEL_CREDENTIAL_INVALID`、`MODEL_RATE_LIMITED`、`MODEL_BALANCE_EXHAUSTED`、`MODEL_PROVIDER_UNAVAILABLE`、`MODEL_DISABLED` 或 `BYOK_DISABLED`。日志仅记录 provider、model、HTTP 状态和关联 ID，不记录 prompt、响应、请求头或凭据。

## 轮换与回滚

1. 使用 `wrangler secret put ORG_AI_MODELS` 写入包含新 token 的完整 JSON；不要把 token 写入仓库、`.env` 提交或发布清单。
2. 等待新的 Worker 版本和 Durable Object 实例读取新 secret 后，再在 Admin 页面确认模型连接。
3. 若供应商密钥失效，先停用受影响模型或清空默认值；已有聊天不会自动改用其它模型。
4. 回滚时恢复上一份 secret JSON，并按需恢复 Admin 模型策略。删除 secret 前应确认没有组织模型仍依赖它。

## 部署服务绑定契约

外部部署服务应将 `ORG_AI_MODELS` 作为后端实例的 secret backend state 注入，将 `ALLOW_USER_BYOK` 作为非敏感后端变量注入，和现有 `backendExtraVars` 合约一致。本仓库的 release manifest 不包含模型目录 secret，也不引入 `$SECRET(ORG_AI_MODELS)` 占位符；模型配置属于部署实例状态，而不是应用发布产物。
