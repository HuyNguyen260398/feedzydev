variable "name_prefix" {
  type        = string
  description = "Prefix for Cognito resource names."
}

variable "domain_prefix" {
  type        = string
  description = "Cognito hosted UI domain prefix."
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

variable "callback_urls" {
  type        = list(string)
  description = "OAuth callback and logout URLs."
}

variable "presignup_lambda_arn" {
  type        = string
  description = "ARN of the pre-sign-up trigger Lambda."
}

variable "presignup_function_name" {
  type        = string
  description = "Name of the pre-sign-up trigger Lambda."
}
