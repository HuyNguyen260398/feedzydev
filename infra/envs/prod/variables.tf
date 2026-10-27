variable "region" {
  type    = string
  default = "ap-southeast-1"
}

variable "name_prefix" {
  type    = string
  default = "feedzydev-claude-prod"
}

variable "domain_name" {
  type    = string
  default = "feedzydev-claude.nghuy.link"
}

variable "hosted_zone_name" {
  type    = string
  default = "nghuy.link"
}

variable "site_bucket_name" {
  type    = string
  default = "feedzydev-claude-prod-site-010382427026"
}

variable "cognito_domain_prefix" {
  type    = string
  default = "feedzydev-claude-010382427026"
}

variable "permissions_boundary_arn" {
  type    = string
  default = "arn:aws:iam::010382427026:policy/feedzydev-claude-prod-boundary"
}

variable "allowed_email" {
  type        = string
  description = "The single email address allowed to sign in."
}

variable "google_client_id" {
  type        = string
  description = "Google OAuth client ID."
}

variable "google_client_secret" {
  type        = string
  description = "Google OAuth client secret."
  sensitive   = true
}

variable "vapid_public_key" {
  type        = string
  description = "Web Push VAPID public key (also baked into the frontend build)."

  # An empty key deploys fine but silently turns push off (crawler logs push.skipped).
  validation {
    condition     = can(regex("^B[A-Za-z0-9_-]{86}$", var.vapid_public_key))
    error_message = "vapid_public_key must be a base64url P-256 public key (87 chars, from `npx web-push generate-vapid-keys`). Is the VAPID_PUBLIC_KEY repo variable set?"
  }
}

variable "vapid_private_key" {
  type        = string
  description = "Web Push VAPID private key, used by the crawler to sign pushes."
  sensitive   = true

  validation {
    condition     = can(regex("^[A-Za-z0-9_-]{43}$", var.vapid_private_key))
    error_message = "vapid_private_key must be a base64url P-256 private key (43 chars). Is the VAPID_PRIVATE_KEY repo secret set?"
  }
}
