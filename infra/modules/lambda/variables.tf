variable "function_name" {
  type        = string
  description = "Lambda function name; the role is named <function_name>-role."
}

variable "zip_path" {
  type        = string
  description = "Path to the deployment zip."
}

variable "permissions_boundary_arn" {
  type        = string
  description = "ARN of the permissions boundary policy attached to the execution role."
}

variable "timeout" {
  type        = number
  description = "Function timeout in seconds."
  default     = 10
}

variable "memory_size" {
  type        = number
  description = "Function memory in MB."
  default     = 256
}

variable "environment" {
  type        = map(string)
  description = "Environment variables."
  default     = {}
}

variable "policy_json" {
  type        = string
  description = "Optional inline IAM policy JSON for the execution role."
  default     = null
}

variable "reserved_concurrency" {
  type        = number
  description = "Reserved concurrent executions; -1 means unreserved."
  default     = -1
}
