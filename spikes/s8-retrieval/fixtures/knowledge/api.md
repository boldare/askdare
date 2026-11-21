---
title: Brightloop REST API
url: https://example.com/developers/api
---

# REST API

The Brightloop REST API lets you read and change projects, tasks and comments from your own code. It is available on the Team and Business plans.

## Authentication

Create a personal access token in **Profile → Developer tokens**. Send it in the `Authorization: Bearer <token>` header. Tokens expire after 365 days and can be revoked at any time. Workspace owners can see and revoke every token in the workspace.

## Rate limits

Each token can make 100 requests per minute. Above the limit the API answers `429 Too Many Requests` with a `Retry-After` header. Business workspaces can ask support for a higher limit, up to 1,000 requests per minute.

## Webhooks

Webhooks send a signed `POST` to your URL when a task is created, updated, completed or deleted. Each delivery carries an `X-Brightloop-Signature` header, an HMAC-SHA256 of the body with your webhook secret. Failed deliveries are retried 5 times over 24 hours, then the webhook is paused.

## Versioning

The current version is `v2`. Version `v1` stops working on 31 March 2027.
