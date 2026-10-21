import os

from celery import Celery
from celery.schedules import crontab

from app import tasks

broker = os.environ.get("REDIS_URL", "redis://127.0.0.1:6379/0")
celery = Celery("monytix.finance", broker=broker)
celery.conf.update(
    task_default_queue="intake",
    task_routes={
        "app.tasks.intake_record": {"queue": "intake"},
        "app.tasks.gmail_history": {"queue": "intake"},
        "app.tasks.gmail_backfill": {"queue": "intake"},
        "app.tasks.renew_gmail_watch": {"queue": "intake"},
        "app.tasks.fetch_fx_rates": {"queue": "intake"},
        "app.tasks.normalize_domain": {"queue": "cash"},
        "app.tasks.reconcile_forex_fees": {"queue": "reconciliation"},
        "app.tasks.evaluate_human_context": {"queue": "context"},
        "app.tasks.evaluate_decision_candidates": {"queue": "decisions"},
        "app.tasks.reconcile_outcomes_mile": {"queue": "reconciliation"},
        "app.tasks.sweep_expired_snoozes": {"queue": "decisions"},
    },
    beat_schedule={
        # Daily ingestion renewals (04:00 IST / 22:30 UTC) and FX (23:00 UTC)
        "renew-gmail-watch": {
            "task": "app.tasks.renew_gmail_watch",
            "schedule": crontab(hour=22, minute=30),
            "options": {"queue": "intake", "expires": 3600},
        },
        "fetch-fx-rates": {
            "task": "app.tasks.fetch_fx_rates",
            "schedule": crontab(hour=23, minute=0),
            "options": {"queue": "intake", "expires": 3600},
        },
        # Forex & fee surcharge reconciliation every 30 minutes
        "periodic-forex-reconciliation-sweep": {
            "task": "app.tasks.reconcile_forex_fees",
            "schedule": crontab(minute="*/30"),
            "options": {"queue": "reconciliation", "expires": 600},
        },
        # Outcomes & M.I.L.E. minting sweeper every 15 minutes
        "periodic-outcomes-mile-sweep": {
            "task": "app.tasks.reconcile_outcomes_mile",
            "schedule": crontab(minute="*/15"),
            "options": {"queue": "reconciliation", "expires": 300},
        },
        # Decision SNOOZE expiry → PRESENTED every hour at :05
        "periodic-decision-expiry-check": {
            "task": "app.tasks.sweep_expired_snoozes",
            "schedule": crontab(minute=5),
            "options": {"queue": "decisions", "expires": 300},
        },
    },
)
tasks.register(celery)
