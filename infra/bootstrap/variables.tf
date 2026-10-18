variable "region" {
  type        = string
  description = "AWS region for the state bucket and regional resources."
  default     = "ap-southeast-1"
}

variable "state_bucket_name" {
  type        = string
  description = "Name of the S3 bucket holding Terraform remote state."
  default     = "feedzydev-claude-tfstate-010382427026"
}

variable "site_bucket_name" {
  type        = string
  description = "Name of the site bucket managed by the main stack (deploy role is scoped to it)."
  default     = "feedzydev-claude-prod-site-010382427026"
}

variable "github_sub_prefix" {
  type        = string
  description = "OIDC sub prefix of the repository allowed to assume the CI roles. The repo uses immutable subjects (owner@id/name@id); see `gh api repos/OWNER/REPO/actions/oidc/customization/sub`."
  default     = "repo:HuyNguyen260398@22511283/feedzydev@1421601952"
}

variable "deploy_branch" {
  type        = string
  description = "Branch allowed to assume the deploy role."
  default     = "feedzydev-claude"
}

variable "name_prefix" {
  type        = string
  description = "Prefix of every resource the deploy role may manage."
  default     = "feedzydev-claude-prod"
}

variable "hosted_zone_id" {
  type        = string
  description = "Route 53 hosted zone the deploy role may change records in."
  default     = "Z10168803Q16IBJCR6YRD"
}
