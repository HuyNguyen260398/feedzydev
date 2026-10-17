output "user_pool_id" {
  value = module.auth.user_pool_id
}

output "user_pool_client_id" {
  value = module.auth.user_pool_client_id
}

output "cognito_domain" {
  value = module.auth.cognito_domain
}

output "site_bucket_name" {
  value = module.frontend.site_bucket_name
}

output "distribution_id" {
  value = module.frontend.distribution_id
}

output "site_url" {
  value = "https://${var.domain_name}"
}

output "crawler_function_name" {
  value = module.crawler.function_name
}

output "schedule_name" {
  value = module.schedule.schedule_name
}
