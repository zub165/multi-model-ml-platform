from django.db import models


class PredictionLog(models.Model):
    model_id = models.CharField(max_length=255, db_index=True)
    features_json = models.TextField()
    prediction = models.FloatField(null=True, blank=True)
    confidence = models.FloatField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)


class LabelFeedback(models.Model):
    """Clinician-confirmed labels for the learning loop."""

    model_id = models.CharField(max_length=255, db_index=True)
    features_json = models.TextField()
    prediction = models.FloatField(null=True, blank=True)
    actual_outcome = models.FloatField()
    created_at = models.DateTimeField(auto_now_add=True)
