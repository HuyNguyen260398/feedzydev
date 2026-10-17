variable "name_prefix" {
  type        = string
  description = "Prefix for frontend resource names."
}

variable "bucket_name" {
  type        = string
  description = "Globally unique S3 bucket name for the static site."
}

variable "domain_name" {
  type        = string
  description = "Public domain name served by CloudFront."
}

variable "zone_id" {
  type        = string
  description = "Route 53 hosted zone ID for the alias records."
}

variable "certificate_arn" {
  type        = string
  description = "ACM certificate ARN (us-east-1) for the domain."
}

variable "api_invoke_domain" {
  type        = string
  description = "API Gateway invoke domain used as the /api/* origin."
}
