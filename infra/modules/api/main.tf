data "aws_region" "current" {}

resource "aws_api_gateway_rest_api" "this" {
  name = "${var.name_prefix}-api"
}

resource "aws_api_gateway_authorizer" "cognito" {
  name            = "cognito"
  type            = "COGNITO_USER_POOLS"
  rest_api_id     = aws_api_gateway_rest_api.this.id
  provider_arns   = [var.user_pool_arn]
  identity_source = "method.request.header.Authorization"
}

resource "aws_api_gateway_resource" "posts" {
  rest_api_id = aws_api_gateway_rest_api.this.id
  parent_id   = aws_api_gateway_rest_api.this.root_resource_id
  path_part   = "posts"
}

resource "aws_api_gateway_resource" "sources" {
  rest_api_id = aws_api_gateway_rest_api.this.id
  parent_id   = aws_api_gateway_rest_api.this.root_resource_id
  path_part   = "sources"
}

resource "aws_api_gateway_resource" "push" {
  rest_api_id = aws_api_gateway_rest_api.this.id
  parent_id   = aws_api_gateway_rest_api.this.root_resource_id
  path_part   = "push"
}

resource "aws_api_gateway_resource" "push_subscriptions" {
  rest_api_id = aws_api_gateway_rest_api.this.id
  parent_id   = aws_api_gateway_resource.push.id
  path_part   = "subscriptions"
}

resource "aws_api_gateway_resource" "push_subscription" {
  rest_api_id = aws_api_gateway_rest_api.this.id
  parent_id   = aws_api_gateway_resource.push_subscriptions.id
  path_part   = "{id}"
}

resource "aws_api_gateway_resource" "admin" {
  rest_api_id = aws_api_gateway_rest_api.this.id
  parent_id   = aws_api_gateway_rest_api.this.root_resource_id
  path_part   = "admin"
}

resource "aws_api_gateway_resource" "admin_proxy" {
  rest_api_id = aws_api_gateway_rest_api.this.id
  parent_id   = aws_api_gateway_resource.admin.id
  path_part   = "{proxy+}"
}

# Public reads
resource "aws_api_gateway_method" "posts" {
  rest_api_id   = aws_api_gateway_rest_api.this.id
  resource_id   = aws_api_gateway_resource.posts.id
  http_method   = "GET"
  authorization = "NONE"
}

resource "aws_api_gateway_integration" "posts" {
  rest_api_id             = aws_api_gateway_rest_api.this.id
  resource_id             = aws_api_gateway_resource.posts.id
  http_method             = aws_api_gateway_method.posts.http_method
  integration_http_method = "POST"
  type                    = "AWS_PROXY"
  uri                     = var.lambda_invoke_arn
}

resource "aws_api_gateway_method" "sources" {
  rest_api_id   = aws_api_gateway_rest_api.this.id
  resource_id   = aws_api_gateway_resource.sources.id
  http_method   = "GET"
  authorization = "NONE"
}

resource "aws_api_gateway_integration" "sources" {
  rest_api_id             = aws_api_gateway_rest_api.this.id
  resource_id             = aws_api_gateway_resource.sources.id
  http_method             = aws_api_gateway_method.sources.http_method
  integration_http_method = "POST"
  type                    = "AWS_PROXY"
  uri                     = var.lambda_invoke_arn
}

# Public push subscribe / unsubscribe (anonymous devices)
resource "aws_api_gateway_method" "push_subscribe" {
  rest_api_id   = aws_api_gateway_rest_api.this.id
  resource_id   = aws_api_gateway_resource.push_subscriptions.id
  http_method   = "POST"
  authorization = "NONE"
}

resource "aws_api_gateway_integration" "push_subscribe" {
  rest_api_id             = aws_api_gateway_rest_api.this.id
  resource_id             = aws_api_gateway_resource.push_subscriptions.id
  http_method             = aws_api_gateway_method.push_subscribe.http_method
  integration_http_method = "POST"
  type                    = "AWS_PROXY"
  uri                     = var.lambda_invoke_arn
}

resource "aws_api_gateway_method" "push_unsubscribe" {
  rest_api_id   = aws_api_gateway_rest_api.this.id
  resource_id   = aws_api_gateway_resource.push_subscription.id
  http_method   = "DELETE"
  authorization = "NONE"
}

resource "aws_api_gateway_integration" "push_unsubscribe" {
  rest_api_id             = aws_api_gateway_rest_api.this.id
  resource_id             = aws_api_gateway_resource.push_subscription.id
  http_method             = aws_api_gateway_method.push_unsubscribe.http_method
  integration_http_method = "POST"
  type                    = "AWS_PROXY"
  uri                     = var.lambda_invoke_arn
}

# Admin (Cognito-protected)
resource "aws_api_gateway_method" "admin_proxy" {
  rest_api_id   = aws_api_gateway_rest_api.this.id
  resource_id   = aws_api_gateway_resource.admin_proxy.id
  http_method   = "ANY"
  authorization = "COGNITO_USER_POOLS"
  authorizer_id = aws_api_gateway_authorizer.cognito.id
  request_parameters = {
    "method.request.path.proxy" = true
  }
}

resource "aws_api_gateway_integration" "admin_proxy" {
  rest_api_id             = aws_api_gateway_rest_api.this.id
  resource_id             = aws_api_gateway_resource.admin_proxy.id
  http_method             = aws_api_gateway_method.admin_proxy.http_method
  integration_http_method = "POST"
  type                    = "AWS_PROXY"
  uri                     = var.lambda_invoke_arn
}

resource "aws_lambda_permission" "apigw" {
  statement_id  = "AllowAPIGatewayInvoke"
  action        = "lambda:InvokeFunction"
  function_name = var.lambda_function_name
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${aws_api_gateway_rest_api.this.execution_arn}/*/*"
}

resource "aws_api_gateway_deployment" "this" {
  rest_api_id = aws_api_gateway_rest_api.this.id

  triggers = {
    redeploy = sha1(jsonencode([
      aws_api_gateway_resource.posts.id,
      aws_api_gateway_resource.sources.id,
      aws_api_gateway_resource.push.id,
      aws_api_gateway_resource.push_subscriptions.id,
      aws_api_gateway_resource.push_subscription.id,
      aws_api_gateway_resource.admin.id,
      aws_api_gateway_resource.admin_proxy.id,
      aws_api_gateway_method.posts.id,
      aws_api_gateway_method.sources.id,
      aws_api_gateway_method.push_subscribe.id,
      aws_api_gateway_method.push_unsubscribe.id,
      aws_api_gateway_method.admin_proxy.id,
      aws_api_gateway_method.admin_proxy.request_parameters,
      aws_api_gateway_integration.posts.id,
      aws_api_gateway_integration.sources.id,
      aws_api_gateway_integration.push_subscribe.id,
      aws_api_gateway_integration.push_unsubscribe.id,
      aws_api_gateway_integration.admin_proxy.id,
      aws_api_gateway_authorizer.cognito.id,
    ]))
  }

  lifecycle {
    create_before_destroy = true
  }
}

resource "aws_api_gateway_stage" "api" {
  rest_api_id   = aws_api_gateway_rest_api.this.id
  deployment_id = aws_api_gateway_deployment.this.id
  stage_name    = "api"
}

resource "aws_api_gateway_method_settings" "all" {
  rest_api_id = aws_api_gateway_rest_api.this.id
  stage_name  = aws_api_gateway_stage.api.stage_name
  method_path = "*/*"

  settings {
    throttling_burst_limit = 20
    throttling_rate_limit  = 10
  }
}
