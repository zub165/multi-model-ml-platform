from django.urls import include, path

urlpatterns = [
    path("", include("ml_api.urls")),
]
