from django.apps import AppConfig


class MlApiConfig(AppConfig):
    default_auto_field = "django.db.models.BigAutoField"
    name = "ml_api"

    def ready(self) -> None:
        import os
        import sys

        # django runserver imports twice; only bootstrap the child process.
        if "runserver" in sys.argv and os.environ.get("RUN_MAIN") != "true":
            return

        from ml_api.bootstrap import bootstrap_models

        bootstrap_models()
