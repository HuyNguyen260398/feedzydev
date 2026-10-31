data "aws_caller_identity" "current" {}

data "aws_route53_zone" "main" {
  name = var.hosted_zone_name
}

locals {
  account_id    = data.aws_caller_identity.current.account_id
  sources_table = "arn:aws:dynamodb:${var.region}:${local.account_id}:table/${var.name_prefix}-sources"
  posts_table   = "arn:aws:dynamodb:${var.region}:${local.account_id}:table/${var.name_prefix}-posts"
  settings_tbl  = "arn:aws:dynamodb:${var.region}:${local.account_id}:table/${var.name_prefix}-settings"
  subs_table    = "arn:aws:dynamodb:${var.region}:${local.account_id}:table/${var.name_prefix}-push-subscriptions"
  crawler_name  = "${var.name_prefix}-crawler"
  crawler_arn   = "arn:aws:lambda:${var.region}:${local.account_id}:function:${local.crawler_name}"
}

# IAM policies are built from names known at plan time (not module outputs) so
# the lambda module's `count = policy_json == null ? 0 : 1` is always known.
data "aws_iam_policy_document" "api" {
  statement {
    actions = [
      "dynamodb:GetItem",
      "dynamodb:PutItem",
      "dynamodb:UpdateItem",
      "dynamodb:DeleteItem",
      "dynamodb:Query",
      "dynamodb:Scan",
      "dynamodb:BatchWriteItem",
    ]
    resources = [
      local.sources_table,
      "${local.sources_table}/index/*",
      local.posts_table,
      "${local.posts_table}/index/*",
    ]
  }
  statement {
    actions   = ["dynamodb:GetItem", "dynamodb:PutItem"]
    resources = [local.settings_tbl]
  }
  # Public subscribe (exists check, cap count, upsert) and unsubscribe.
  statement {
    actions   = ["dynamodb:GetItem", "dynamodb:UpdateItem", "dynamodb:DeleteItem", "dynamodb:Scan"]
    resources = [local.subs_table]
  }
  statement {
    actions   = ["lambda:InvokeFunction"]
    resources = [local.crawler_arn]
  }
}

data "aws_iam_policy_document" "crawler" {
  statement {
    actions   = ["dynamodb:Scan", "dynamodb:GetItem", "dynamodb:UpdateItem"]
    resources = [local.sources_table]
  }
  statement {
    actions   = ["dynamodb:GetItem", "dynamodb:PutItem", "dynamodb:UpdateItem"]
    resources = [local.posts_table]
  }
  # Retention purge: find expired posts on byPublished, then batch-delete them.
  statement {
    actions   = ["dynamodb:Query", "dynamodb:BatchWriteItem"]
    resources = [local.posts_table, "${local.posts_table}/index/byPublished"]
  }
  statement {
    actions   = ["dynamodb:GetItem"]
    resources = [local.settings_tbl]
  }
  # Push fan-out: list subscribers and prune the ones push services report gone.
  statement {
    actions   = ["dynamodb:Scan", "dynamodb:DeleteItem"]
    resources = [local.subs_table]
  }
}

data "archive_file" "api" {
  type        = "zip"
  source_file = "${path.module}/../../../backend/dist/api/index.js"
  output_path = "${path.module}/../../../backend/dist/api.zip"
}

data "archive_file" "crawler" {
  type        = "zip"
  source_file = "${path.module}/../../../backend/dist/crawler/index.js"
  output_path = "${path.module}/../../../backend/dist/crawler.zip"
}

data "archive_file" "presignup" {
  type        = "zip"
  source_file = "${path.module}/../../../backend/dist/presignup/index.js"
  output_path = "${path.module}/../../../backend/dist/presignup.zip"
}

module "data" {
  source      = "../../modules/data"
  name_prefix = var.name_prefix
}

module "api_lambda" {
  source                   = "../../modules/lambda"
  function_name            = "${var.name_prefix}-api"
  zip_path                 = data.archive_file.api.output_path
  permissions_boundary_arn = var.permissions_boundary_arn
  timeout                  = 29
  memory_size              = 256
  environment = {
    SOURCES_TABLE         = module.data.sources_table_name
    POSTS_TABLE           = module.data.posts_table_name
    SETTINGS_TABLE        = module.data.settings_table_name
    SUBSCRIPTIONS_TABLE   = module.data.push_subscriptions_table_name
    ALLOWED_EMAIL         = var.allowed_email
    CRAWLER_FUNCTION_NAME = local.crawler_name
  }
  policy_json = data.aws_iam_policy_document.api.json
}

module "crawler" {
  source                   = "../../modules/lambda"
  function_name            = local.crawler_name
  zip_path                 = data.archive_file.crawler.output_path
  permissions_boundary_arn = var.permissions_boundary_arn
  timeout                  = 300
  memory_size              = 512
  reserved_concurrency     = 1
  environment = {
    SOURCES_TABLE       = module.data.sources_table_name
    POSTS_TABLE         = module.data.posts_table_name
    SETTINGS_TABLE      = module.data.settings_table_name
    SUBSCRIPTIONS_TABLE = module.data.push_subscriptions_table_name
    VAPID_PUBLIC_KEY    = var.vapid_public_key
    VAPID_PRIVATE_KEY   = var.vapid_private_key
    VAPID_SUBJECT       = "mailto:${var.allowed_email}"
  }
  policy_json = data.aws_iam_policy_document.crawler.json
}

module "presignup" {
  source                   = "../../modules/lambda"
  function_name            = "${var.name_prefix}-presignup"
  zip_path                 = data.archive_file.presignup.output_path
  permissions_boundary_arn = var.permissions_boundary_arn
  timeout                  = 5
  environment = {
    ALLOWED_EMAIL = var.allowed_email
  }
}

module "auth" {
  source                  = "../../modules/auth"
  name_prefix             = var.name_prefix
  domain_prefix           = var.cognito_domain_prefix
  google_client_id        = var.google_client_id
  google_client_secret    = var.google_client_secret
  callback_urls           = ["https://${var.domain_name}/sources/", "http://localhost:3000/sources/"]
  presignup_lambda_arn    = module.presignup.arn
  presignup_function_name = module.presignup.function_name
}

module "schedule" {
  source                   = "../../modules/schedule"
  name_prefix              = var.name_prefix
  target_lambda_arn        = module.crawler.arn
  target_function_name     = module.crawler.function_name
  permissions_boundary_arn = var.permissions_boundary_arn
}

module "api" {
  source               = "../../modules/api"
  name_prefix          = var.name_prefix
  user_pool_arn        = module.auth.user_pool_arn
  lambda_invoke_arn    = module.api_lambda.invoke_arn
  lambda_function_name = module.api_lambda.function_name
}

module "certificate" {
  source      = "../../modules/certificate"
  providers   = { aws = aws.us_east_1 }
  domain_name = var.domain_name
  zone_id     = data.aws_route53_zone.main.zone_id
}

module "frontend" {
  source            = "../../modules/frontend"
  name_prefix       = var.name_prefix
  bucket_name       = var.site_bucket_name
  domain_name       = var.domain_name
  zone_id           = data.aws_route53_zone.main.zone_id
  certificate_arn   = module.certificate.certificate_arn
  api_invoke_domain = module.api.invoke_domain
}
