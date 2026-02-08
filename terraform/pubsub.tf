# Incoming location data topic
resource "google_pubsub_topic" "incoming_location_data" {
  name                       = var.incoming_topic_name
  message_retention_duration = "${var.message_retention_days * 86400}s" # Convert days to seconds

  labels = {
    environment = var.environment
    purpose     = "incoming-data"
  }

  depends_on = [google_project_iam_member.dataflow_worker_pubsub]
}

# Subscription for Dataflow to consume incoming messages
resource "google_pubsub_subscription" "incoming_location_subscription" {
  name                 = "${var.incoming_topic_name}-subscription"
  topic                = google_pubsub_topic.incoming_location_data.name
  ack_deadline_seconds = 60

  # Dataflow will manage message acknowledgment
  enable_message_ordering = false

  labels = {
    environment = var.environment
    consumer    = "dataflow"
  }
}

# Notifications topic (for Dataflow to publish notifications)
resource "google_pubsub_topic" "notifications" {
  name = var.notifications_topic_name

  labels = {
    environment = var.environment
    purpose     = "notifications"
  }
}

# Subscription for notifications
resource "google_pubsub_subscription" "notifications_subscription" {
  name                 = "${var.notifications_topic_name}-subscription"
  topic                = google_pubsub_topic.notifications.name
  ack_deadline_seconds = 60

  labels = {
    environment = var.environment
    consumer    = "applications"
  }
}

# Processed location data topic (for Dataflow to publish processed locations)
resource "google_pubsub_topic" "processed_location_data" {
  name = var.location_data_topic_name

  labels = {
    environment = var.environment
    purpose     = "processed-data"
  }
}

# Subscription for processed location data
resource "google_pubsub_subscription" "processed_location_subscription" {
  name                 = "${var.location_data_topic_name}-subscription"
  topic                = google_pubsub_topic.processed_location_data.name
  ack_deadline_seconds = 60

  labels = {
    environment = var.environment
    consumer    = "applications"
  }
}

# Forbidden or relevant locations topic (for Dataflow to publish forbidden/relevant locations)
resource "google_pubsub_topic" "forbidden_relevant_location_data" {
  name = var.forbidden_relevant_topic_name

  labels = {
    environment = var.environment
    purpose     = "forbidden-relevant-data"
  }
}

# Subscription for forbidden/relevant location data
resource "google_pubsub_subscription" "forbidden_relevant_location_subscription" {
  name                 = "${var.forbidden_relevant_topic_name}-subscription"
  topic                = google_pubsub_topic.forbidden_relevant_location_data.name
  ack_deadline_seconds = 60

  labels = {
    environment = var.environment
    consumer    = "applications"
  }
}

# Output topic names and subscription names for reference
output "pubsub_topics" {
  description = "Pub/Sub topic names and their subscriptions"
  value = {
    incoming_location = {
      topic        = google_pubsub_topic.incoming_location_data.name
      subscription = google_pubsub_subscription.incoming_location_subscription.name
    }
    notifications = {
      topic        = google_pubsub_topic.notifications.name
      subscription = google_pubsub_subscription.notifications_subscription.name
    }
    processed_location = {
      topic        = google_pubsub_topic.processed_location_data.name
      subscription = google_pubsub_subscription.processed_location_subscription.name
    }
    forbidden_relevant_location = {
      topic        = google_pubsub_topic.forbidden_relevant_location_data.name
      subscription = google_pubsub_subscription.forbidden_relevant_location_subscription.name
    }
  }
}
