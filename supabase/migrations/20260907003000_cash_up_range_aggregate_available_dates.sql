-- Persist available sales dates on the cash-up range aggregate so Ask NAC
-- does not need a second coverage query or a full daily metric dump.

create or replace function public.get_vault_cash_up_range_aggregate(
  p_start_date date,
  p_end_date date,
  p_branch_id text default null,
  p_include_daily_breakdown boolean default false
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_result jsonb;
begin
  perform set_config('statement_timeout', '25000', true);

  if auth.uid() is null then
    raise exception 'authentication required';
  end if;

  if p_branch_id is not null and not public.ask_nac_vault_branch_allowed(p_branch_id) then
    raise exception 'branch access denied';
  end if;

  if p_branch_id is null and not public.ask_nac_vault_has_all_branches() then
    raise exception 'network-wide cash-up aggregation requires all-branch access';
  end if;

  if not public.ask_nac_vault_can_read_sensitivity('internal') then
    raise exception 'insufficient sensitivity access for cash-up aggregation';
  end if;

  if p_start_date is null or p_end_date is null then
    return jsonb_build_object(
      'dayCount', 0,
      'dailyBreakdown', '[]'::jsonb,
      'availableDates', '[]'::jsonb,
      'deliveryPlatformBreakdown', '{}'::jsonb
    );
  end if;

  with filtered as (
    select
      f.period_end as business_date,
      f.metric_key,
      f.metric_value,
      f.dimensions,
      case
        when lower(coalesce(f.dimensions->>'platform', '')) like '%jahez%' then 'jahez'
        when lower(coalesce(f.dimensions->>'platform', '')) like '%chefz%'
          or lower(coalesce(f.dimensions->>'platform', '')) like '%the chefz%' then 'chefz'
        when lower(coalesce(f.dimensions->>'platform', '')) like '%keeta%' then 'keeta'
        when lower(coalesce(f.dimensions->>'platform', '')) like '%hunger%' then 'hunger'
        else null
      end as platform_key
    from public.ask_nac_structured_facts f
    where f.report_type = 'cash_up'
      and f.metric_key in (
        'gross_sales', 'net_sales', 'total_sales',
        'guest_count', 'order_count',
        'delivery_sales', 'delivery_orders'
      )
      and f.period_start <= p_end_date
      and f.period_end >= p_start_date
      and (p_branch_id is null or f.branch_id = p_branch_id)
      and f.archived_at is null
  ),
  daily_metrics as (
    select
      business_date,
      max(case when metric_key = 'net_sales' and platform_key is null then metric_value end) as net_sales_agg,
      max(case when metric_key = 'total_sales' and platform_key is null then metric_value end) as total_sales_agg,
      max(case when metric_key = 'gross_sales' and platform_key is null then metric_value end) as gross_sales_agg,
      max(case when metric_key = 'guest_count' and platform_key is null then metric_value end) as guest_count,
      max(case when metric_key = 'order_count' and platform_key is null then metric_value end) as order_count,
      max(case when metric_key = 'delivery_sales' and platform_key is null then metric_value end) as delivery_sales_agg,
      coalesce(sum(case when metric_key = 'delivery_sales' and platform_key is not null then metric_value else 0 end), 0) as delivery_sales_platform,
      max(case when metric_key = 'delivery_orders' and platform_key is null then metric_value end) as delivery_orders_agg,
      coalesce(sum(case when metric_key = 'delivery_orders' and platform_key is not null then metric_value else 0 end), 0) as delivery_orders_platform
    from filtered
    group by business_date
  ),
  daily as (
    select
      business_date,
      coalesce(net_sales_agg, total_sales_agg, gross_sales_agg) as day_sales,
      guest_count,
      order_count,
      case
        when delivery_sales_agg is not null and delivery_sales_agg <> 0 then delivery_sales_agg
        when delivery_sales_platform <> 0 then delivery_sales_platform
        else null
      end as day_delivery_sales,
      case
        when delivery_orders_agg is not null and delivery_orders_agg <> 0 then delivery_orders_agg
        when delivery_orders_platform <> 0 then delivery_orders_platform
        else null
      end as day_delivery_orders
    from daily_metrics
    where business_date >= p_start_date
      and business_date <= p_end_date
  ),
  totals as (
    select
      count(*) filter (where day_sales is not null or guest_count is not null) as day_count,
      sum(day_sales) as total_sales,
      sum(guest_count) as total_guests,
      sum(order_count) as total_orders,
      sum(day_delivery_sales) as total_delivery_sales,
      sum(day_delivery_orders) as total_delivery_orders,
      min(business_date) filter (where day_sales is not null) as sales_coverage_start,
      max(business_date) filter (where day_sales is not null) as sales_coverage_end,
      min(business_date) filter (where day_delivery_orders is not null) as delivery_order_coverage_start
    from daily
  ),
  platform_raw as (
    select
      platform_key as platform,
      sum(case when metric_key = 'delivery_sales' then metric_value else 0 end) as sales,
      sum(case when metric_key = 'delivery_orders' then metric_value else 0 end) as orders
    from filtered
    where platform_key is not null
      and metric_key in ('delivery_sales', 'delivery_orders')
    group by platform_key
  ),
  platform_totals as (
    select coalesce(sum(sales), 0) as total_platform_sales, coalesce(sum(orders), 0) as total_platform_orders
    from platform_raw
  ),
  platform_breakdown as (
    select coalesce(
      jsonb_object_agg(
        platform,
        jsonb_build_object(
          'sales', sales,
          'orders', orders,
          'averageOrderValue', case when orders > 0 then sales / orders else null end,
          'salesShare', case when pt.total_platform_sales > 0 then (sales / pt.total_platform_sales) * 100 else null end,
          'orderShare', case when pt.total_platform_orders > 0 then (orders / pt.total_platform_orders) * 100 else null end
        )
      ),
      '{}'::jsonb
    ) as breakdown
    from platform_raw pr
    cross join platform_totals pt
  ),
  top_platforms as (
    select
      (select platform from platform_raw order by sales desc nulls last limit 1) as top_by_sales,
      (select platform from platform_raw order by orders desc nulls last limit 1) as top_by_orders
  )
  select jsonb_build_object(
    'totalSales', t.total_sales,
    'totalGuests', t.total_guests,
    'totalOrders', t.total_orders,
    'averageSpend', case when t.total_guests > 0 then t.total_sales / t.total_guests else null end,
    'totalDeliverySales', t.total_delivery_sales,
    'totalDeliveryOrders', t.total_delivery_orders,
    'dayCount', coalesce(t.day_count, 0),
    'salesCoverageStart', t.sales_coverage_start,
    'salesCoverageEnd', t.sales_coverage_end,
    'deliveryOrderCoverageStart', t.delivery_order_coverage_start,
    'availableDates', coalesce(
      (
        select jsonb_agg(d.business_date order by d.business_date)
        from daily d
        where d.day_sales is not null
      ),
      '[]'::jsonb
    ),
    'deliveryPlatformBreakdown', coalesce(pb.breakdown, '{}'::jsonb),
    'topPlatformBySales', tp.top_by_sales,
    'topPlatformByOrders', tp.top_by_orders,
    'dailyBreakdown', case
      when p_include_daily_breakdown then coalesce(
        (
          select jsonb_agg(
            jsonb_build_object(
              'date', d.business_date,
              'totalSales', d.day_sales,
              'totalGuests', d.guest_count,
              'totalOrders', d.order_count,
              'totalDeliverySales', d.day_delivery_sales,
              'totalDeliveryOrders', d.day_delivery_orders
            )
            order by d.business_date
          )
          from daily d
        ),
        '[]'::jsonb
      )
      else '[]'::jsonb
    end
  )
  into v_result
  from totals t
  cross join platform_breakdown pb
  cross join top_platforms tp;

  return coalesce(v_result, jsonb_build_object(
    'dayCount', 0,
    'dailyBreakdown', '[]'::jsonb,
    'availableDates', '[]'::jsonb,
    'deliveryPlatformBreakdown', '{}'::jsonb
  ));
end;
$$;

comment on function public.get_vault_cash_up_range_aggregate(date, date, text, boolean) is
  'Cash-up range totals, coverage dates, and optional daily breakdown. Branch-gated security definer.';

revoke all on function public.get_vault_cash_up_range_aggregate(date, date, text, boolean) from public;
grant execute on function public.get_vault_cash_up_range_aggregate(date, date, text, boolean) to authenticated;
