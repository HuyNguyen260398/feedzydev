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
