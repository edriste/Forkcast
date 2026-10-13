-- Keep RPC-supplied dates compatible with the app's ISO calendar and deadline timers.
alter table public.office_orders add constraint office_order_calendar_dates check(
  isfinite(order_date) and order_date between date '0001-01-01' and date '9999-12-31'
  and isfinite(signup_deadline) and (signup_deadline at time zone 'Europe/Berlin')::date between date '0001-01-01' and date '9999-12-31'
  and (arrival_at is null or (isfinite(arrival_at) and (arrival_at at time zone 'Europe/Berlin')::date=order_date))
);
notify pgrst,'reload schema';
