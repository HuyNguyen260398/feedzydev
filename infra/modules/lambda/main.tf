data "aws_iam_policy_document" "assume" {
  statement {
    actions = ["sts:AssumeRole"]
    principals {
      type        = "Service"
      identifiers = ["lambda.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "lambda" {
  name                 = "${var.function_name}-role"
  assume_role_policy   = data.aws_iam_policy_document.assume.json
  permissions_boundary = var.permissions_boundary_arn
}

resource "aws_iam_role_policy_attachment" "logs" {
  role       = aws_iam_role.lambda.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole"
}

resource "aws_iam_role_policy" "inline" {
  count = var.policy_json == null ? 0 : 1

  name   = "${var.function_name}-access"
  role   = aws_iam_role.lambda.id
  policy = var.policy_json
}

resource "aws_cloudwatch_log_group" "lambda" {
  name              = "/aws/lambda/${var.function_name}"
  retention_in_days = 30
}

resource "aws_lambda_function" "this" {
  function_name = var.function_name
  role          = aws_iam_role.lambda.arn
  runtime       = "nodejs24.x"
  handler       = "index.handler"
  architectures = ["arm64"]
  timeout       = var.timeout
  memory_size   = var.memory_size

  filename         = var.zip_path
  source_code_hash = filebase64sha256(var.zip_path)

  reserved_concurrent_executions = var.reserved_concurrency

  dynamic "environment" {
    for_each = length(var.environment) > 0 ? [1] : []
    content {
      variables = var.environment
    }
  }

  depends_on = [
    aws_cloudwatch_log_group.lambda,
    aws_iam_role_policy_attachment.logs,
    aws_iam_role_policy.inline,
  ]
}
