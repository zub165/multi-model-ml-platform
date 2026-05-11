from django.urls import path

from ml_api import views

urlpatterns = [
    path("", views.root),
    path("health", views.health),
    path("predict", views.predict),
    path("batch_predict", views.batch_predict),
    path("models", views.list_models),
    path("models/<str:model_id>", views.model_detail),
    path("register_model", views.register_model),
    path("feedback", views.feedback),
    path("retrain", views.retrain),
    path("stats/<str:model_id>", views.stats),
]
