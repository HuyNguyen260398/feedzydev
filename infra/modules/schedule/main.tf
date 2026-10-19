data "aws_iam_policy_document" "assume" {
  statement {
    actions = ["sts:AssumeRole"]
    principals {
      type        = "Service"
      identifiers = ["scheduler.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "scheduler" {
  name                 = "${var.name_prefix}-scheduler-role"
  assume_role_policy   = data.aws_iam_policy_document.assume.json
  permissions_boundary = var.permissions_boundary_arn
}

data "aws_iam_policy_document" "invoke" {
  statement {
    actions   = ["lambda:InvokeFunction"]
    resources = [var.target_lambda_arn]
  }
}

resource "aws_iam_role_policy" "invoke" {
  name   = "${var.name_prefix}-scheduler-invoke"
  role   = aws_iam_role.scheduler.id
  policy = data.aws_iam_policy_document.invoke.json
}

# Hourly ticker: the crawler compares the hour against the crawl hours saved in
# settings and exits early on any other hour, so the time is editable from the UI.
resource "aws_scheduler_schedule" "daily_crawl" {
  name                         = "${var.name_prefix}-daily-crawl"
  schedule_expression          = "cron(0 * * * ? *)"
  schedule_expression_timezone = "Asia/Ho_Chi_Minh"

  flexible_time_window {
    mode = "OFF"
  }

  target {
    arn      = var.target_lambda_arn
    role_arn = aws_iam_role.scheduler.arn
    input    = jsonencode({ scheduled = true })

    retry_policy {
      maximum_retry_attempts = 2
    }
  }

  depends_on = [aws_iam_role_policy.invoke]
}
