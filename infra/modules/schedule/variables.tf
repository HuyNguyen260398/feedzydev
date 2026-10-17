variable "name_prefix" {
  type        = string
  description = "Prefix for the schedule and its IAM role."
}

variable "target_lambda_arn" {
  type        = string
  description = "ARN of the Lambda invoked by the schedule."
}

variable "target_function_name" {
  type        = string
  description = "Name of the Lambda invoked by the schedule."
}

variable "permissions_boundary_arn" {
  type        = string
  description = "ARN of the permissions boundary policy attached to the scheduler role."
}
