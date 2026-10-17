variable "name_prefix" {
  type        = string
  description = "Prefix for API resource names."
}

variable "user_pool_arn" {
  type        = string
  description = "ARN of the Cognito user pool used by the authorizer."
}

variable "lambda_invoke_arn" {
  type        = string
  description = "Invoke ARN of the API Lambda."
}

variable "lambda_function_name" {
  type        = string
  description = "Name of the API Lambda."
}
