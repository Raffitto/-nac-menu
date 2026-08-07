-- Phase D: deterministic STANDARD -> ACTUAL -> VARIANCE evidence foundation.
-- Source movements, counts, costs, recipes, purchases, and exceptions remain unchanged.

create index if not exists inventory_movements_branch_business_item_idx
  on public.inventory_movements (branch_id, business_date, ingredient_id, effective_at, id)
  where status = 'posted';

create index if not exists inventory_stock_counts_branch_business_status_idx
  on public.inventory_stock_counts (branch_id, business_date desc, status, count_session_id);

create table if not exists public.inventory_variance_reviews (
  id uuid primary key default gen_random_uuid(),
  branch_id text not null,
  ingredient_id uuid not null references public.inventory_ingredients(id),
  period_start date not null,
  period_end date not null,
  count_session_id uuid references public.inventory_count_sessions(id),
  stock_count_id uuid references public.inventory_stock_counts(id),
  status text not null default 'OPEN' check (status in (
    'OPEN', 'REVIEWING', 'EXPLAINED', 'ACTION_REQUIRED', 'RESOLVED', 'DISMISSED'
  )),
  resolution_reason text,
  corrective_reference jsonb not null default '{}'::jsonb,
  created_by uuid not null references auth.users(id),
  updated_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  resolved_at timestamptz,
  unique (branch_id, ingredient_id, period_start, period_end),
  check (period_end >= period_start)
);

create index if not exists inventory_variance_reviews_branch_status_idx
  on public.inventory_variance_reviews (branch_id, status, period_end desc);

comment on table public.inventory_variance_reviews is
  'Review workflow for a dynamically calculated variance. Source transactions are never changed by review resolution.';

alter table public.inventory_variance_reviews enable row level security;
revoke all on public.inventory_variance_reviews from anon, authenticated;
grant select on public.inventory_variance_reviews to authenticated;

create policy inventory_variance_reviews_select
on public.inventory_variance_reviews
for select to authenticated
using (public.inventory_branch_allowed(branch_id));

create or replace function public.inventory_variance_analysis(
  p_branch_id text,
  p_period_start date,
  p_period_end date,
  p_ingredient_id uuid default null,
  p_stale_cost_days integer default 90
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_cost_health jsonb;
  v_recipe_coverage numeric := 0;
  v_result jsonb;
begin
  if p_branch_id is null or p_period_start is null or p_period_end is null then
    raise exception 'Branch, period start, and period end are required';
  end if;
  if p_period_end < p_period_start then
    raise exception 'Period end must be on or after period start';
  end if;
  if p_stale_cost_days < 1 then
    raise exception 'Stale cost threshold must be at least one day';
  end if;
  if not public.inventory_branch_allowed(p_branch_id) then
    raise exception 'Variance analysis branch access denied' using errcode = '42501';
  end if;

  v_cost_health := public.inventory_cost_health_as_of(
    p_branch_id, p_period_end, p_stale_cost_days
  );
  v_recipe_coverage := coalesce(
    nullif(v_cost_health #>> '{summary,coveragePct}', '')::numeric,
    0
  );

  with
  session_counts as (
    select
      s.branch_id,
      l.ingredient_id,
      s.id as count_session_id,
      null::uuid as stock_count_id,
      s.business_date,
      s.effective_at,
      sum(l.expected_quantity) as expected_quantity,
      sum(l.counted_quantity) as counted_quantity,
      min(l.canonical_unit) as canonical_unit,
      count(distinct c.storage_location_id) as counted_location_count,
      (
        select count(*)
        from public.inventory_stock_counts selected
        where selected.count_session_id = s.id
      ) as selected_location_count,
      coalesce(
        jsonb_path_query_array(jsonb_agg(l.guardrail_warnings), '$[*][*]'),
        '[]'::jsonb
      ) as warnings,
      jsonb_agg(distinct l.warning_confirmation_reason)
        filter (where l.warning_confirmation_reason is not null) as override_reasons,
      array_agg(l.adjustment_movement_id)
        filter (where l.adjustment_movement_id is not null) as adjustment_ids,
      jsonb_agg(jsonb_build_object(
        'stockCountId', c.id,
        'countLineId', l.id,
        'storageLocationId', c.storage_location_id,
        'expectedQuantity', l.expected_quantity,
        'countedQuantity', l.counted_quantity,
        'varianceQuantity', l.variance_quantity,
        'sourceQuantity', l.source_counted_quantity,
        'sourceUnit', l.source_count_unit,
        'conversionFactor', l.conversion_factor,
        'warnings', l.guardrail_warnings,
        'overrideReason', l.warning_confirmation_reason,
        'adjustmentMovementId', l.adjustment_movement_id
      ) order by c.storage_location_id) as count_evidence
    from public.inventory_count_sessions s
    join public.inventory_stock_counts c on c.count_session_id = s.id
    join public.inventory_stock_count_lines l on l.stock_count_id = c.id
    where s.branch_id = p_branch_id
      and s.status = 'posted'
      and s.business_date between p_period_start and p_period_end
      and (p_ingredient_id is null or l.ingredient_id = p_ingredient_id)
    group by s.id, l.ingredient_id
  ),
  standalone_counts as (
    select
      c.branch_id,
      l.ingredient_id,
      null::uuid as count_session_id,
      c.id as stock_count_id,
      c.business_date,
      c.effective_at,
      l.expected_quantity,
      l.counted_quantity,
      l.canonical_unit,
      1::bigint as counted_location_count,
      1::bigint as selected_location_count,
      l.guardrail_warnings as warnings,
      case
        when l.warning_confirmation_reason is null then null
        else jsonb_build_array(l.warning_confirmation_reason)
      end as override_reasons,
      case
        when l.adjustment_movement_id is null then null
        else array[l.adjustment_movement_id]
      end as adjustment_ids,
      jsonb_build_array(jsonb_build_object(
        'stockCountId', c.id,
        'countLineId', l.id,
        'storageLocationId', c.storage_location_id,
        'expectedQuantity', l.expected_quantity,
        'countedQuantity', l.counted_quantity,
        'varianceQuantity', l.variance_quantity,
        'sourceQuantity', l.source_counted_quantity,
        'sourceUnit', l.source_count_unit,
        'conversionFactor', l.conversion_factor,
        'warnings', l.guardrail_warnings,
        'overrideReason', l.warning_confirmation_reason,
        'adjustmentMovementId', l.adjustment_movement_id
      )) as count_evidence
    from public.inventory_stock_counts c
    join public.inventory_stock_count_lines l on l.stock_count_id = c.id
    where c.branch_id = p_branch_id
      and c.status = 'posted'
      and c.count_session_id is null
      and c.business_date between p_period_start and p_period_end
      and (p_ingredient_id is null or l.ingredient_id = p_ingredient_id)
  ),
  count_candidates as (
    select * from session_counts
    union all
    select * from standalone_counts
  ),
  latest_count as (
    select distinct on (ingredient_id) *
    from count_candidates
    order by ingredient_id, effective_at desc, count_session_id desc nulls last, stock_count_id desc nulls last
  ),
  relevant_items as (
    select i.id as ingredient_id
    from public.inventory_ingredients i
    where (i.branch_id is null or i.branch_id = p_branch_id)
      and (
        i.active
        or exists (
          select 1 from public.inventory_movements m
          where m.branch_id = p_branch_id
            and m.ingredient_id = i.id
            and m.status = 'posted'
            and m.business_date <= p_period_end
        )
        or exists (
          select 1 from latest_count lc where lc.ingredient_id = i.id
        )
      )
      and (p_ingredient_id is null or i.id = p_ingredient_id)
  ),
  movement_aggregates as (
    select
      ri.ingredient_id,
      coalesce(sum(m.signed_canonical_quantity) filter (
        where m.business_date < p_period_start
      ), 0) as opening_quantity,
      coalesce(sum(greatest(m.signed_canonical_quantity, 0)) filter (
        where m.business_date between p_period_start and coalesce(lc.business_date, p_period_end)
          and m.movement_type = 'purchase_receipt'
          and not (m.id = any(coalesce(lc.adjustment_ids, '{}'::uuid[])))
      ), 0) as purchases,
      coalesce(sum(abs(m.signed_canonical_quantity)) filter (
        where m.business_date between p_period_start and coalesce(lc.business_date, p_period_end)
          and m.movement_type = 'return_to_supplier'
          and not (m.id = any(coalesce(lc.adjustment_ids, '{}'::uuid[])))
      ), 0) as returns_to_supplier,
      coalesce(sum(greatest(m.signed_canonical_quantity, 0)) filter (
        where m.business_date between p_period_start and coalesce(lc.business_date, p_period_end)
          and m.movement_type = 'transfer_in'
          and not (m.id = any(coalesce(lc.adjustment_ids, '{}'::uuid[])))
      ), 0) as transfers_in,
      coalesce(sum(abs(m.signed_canonical_quantity)) filter (
        where m.business_date between p_period_start and coalesce(lc.business_date, p_period_end)
          and m.movement_type = 'transfer_out'
          and not (m.id = any(coalesce(lc.adjustment_ids, '{}'::uuid[])))
      ), 0) as transfers_out,
      coalesce(sum(abs(m.signed_canonical_quantity)) filter (
        where m.business_date between p_period_start and coalesce(lc.business_date, p_period_end)
          and m.movement_type = 'staff_meal'
          and not (m.id = any(coalesce(lc.adjustment_ids, '{}'::uuid[])))
      ), 0) as staff_meal,
      coalesce(sum(abs(m.signed_canonical_quantity)) filter (
        where m.business_date between p_period_start and coalesce(lc.business_date, p_period_end)
          and m.movement_type in ('disposal', 'operational_use')
          and not (m.id = any(coalesce(lc.adjustment_ids, '{}'::uuid[])))
      ), 0) as operational_disposal,
      coalesce(sum(abs(m.signed_canonical_quantity)) filter (
        where m.business_date between p_period_start and coalesce(lc.business_date, p_period_end)
          and m.movement_type in (
            'wastage', 'production_waste', 'order_waste', 'spoilage', 'breakage'
          )
          and not (m.id = any(coalesce(lc.adjustment_ids, '{}'::uuid[])))
      ), 0) as recorded_waste,
      coalesce(sum(abs(m.signed_canonical_quantity)) filter (
        where m.business_date between p_period_start and coalesce(lc.business_date, p_period_end)
          and m.movement_type in ('production_consumption', 'production_out')
          and not (m.id = any(coalesce(lc.adjustment_ids, '{}'::uuid[])))
      ), 0) as production_input,
      coalesce(sum(greatest(m.signed_canonical_quantity, 0)) filter (
        where m.business_date between p_period_start and coalesce(lc.business_date, p_period_end)
          and m.movement_type in ('production_output', 'production_in')
          and not (m.id = any(coalesce(lc.adjustment_ids, '{}'::uuid[])))
      ), 0) as production_output,
      coalesce(sum(abs(m.signed_canonical_quantity)) filter (
        where m.business_date between p_period_start and coalesce(lc.business_date, p_period_end)
          and m.movement_type in ('sale_consumption', 'order_consumption')
          and not (m.id = any(coalesce(lc.adjustment_ids, '{}'::uuid[])))
      ), 0) as actual_order_consumption,
      coalesce(sum(abs(m.signed_canonical_quantity)) filter (
        where m.business_date between p_period_start and coalesce(lc.business_date, p_period_end)
          and m.movement_type in ('complimentary', 'complimentary_internal_use')
          and not (m.id = any(coalesce(lc.adjustment_ids, '{}'::uuid[])))
      ), 0) as complimentary,
      coalesce(sum(m.signed_canonical_quantity) filter (
        where m.business_date between p_period_start and coalesce(lc.business_date, p_period_end)
          and m.movement_type in (
            'opening_balance', 'manual_adjustment', 'correction', 'physical_count_adjustment'
          )
          and not (m.id = any(coalesce(lc.adjustment_ids, '{}'::uuid[])))
      ), 0) as adjustments_net,
      coalesce(jsonb_agg(jsonb_build_object(
        'movementId', m.id,
        'movementType', m.movement_type,
        'quantity', m.signed_canonical_quantity,
        'unitCost', m.unit_cost,
        'totalCost', m.total_cost,
        'businessDate', m.business_date,
        'effectiveAt', m.effective_at,
        'sourceType', m.source_type,
        'sourceId', m.source_id,
        'sourceReference', m.source_reference,
        'reasonCode', m.reason_code
      ) order by m.effective_at, m.id) filter (
        where m.business_date between p_period_start and coalesce(lc.business_date, p_period_end)
          and not (m.id = any(coalesce(lc.adjustment_ids, '{}'::uuid[])))
      ), '[]'::jsonb) as movement_evidence
    from relevant_items ri
    left join latest_count lc on lc.ingredient_id = ri.ingredient_id
    left join public.inventory_movements m
      on m.branch_id = p_branch_id
      and m.ingredient_id = ri.ingredient_id
      and m.status = 'posted'
      and m.business_date <= coalesce(lc.business_date, p_period_end)
    group by ri.ingredient_id
  ),
  running_stock as (
    select
      m.ingredient_id,
      m.business_date,
      m.effective_at,
      m.id,
      sum(m.signed_canonical_quantity) over (
        partition by m.ingredient_id
        order by m.effective_at, m.recorded_at, m.id
        rows between unbounded preceding and current row
      ) as running_quantity
    from public.inventory_movements m
    join relevant_items ri on ri.ingredient_id = m.ingredient_id
    where m.branch_id = p_branch_id
      and m.status = 'posted'
      and m.business_date <= p_period_end
  ),
  first_negative as (
    select ingredient_id, min(business_date) as first_negative_date
    from running_stock
    where running_quantity < 0
    group by ingredient_id
  ),
  current_exceptions as (
    select
      e.ingredient_id,
      jsonb_agg(jsonb_build_object(
        'exceptionId', e.id,
        'exceptionType', e.exception_type,
        'likelyCause', e.likely_cause,
        'severity', e.severity,
        'status', e.status,
        'title', e.title,
        'message', e.message,
        'evidence', e.evidence,
        'detectedAt', e.detected_at
      ) order by e.detected_at desc) as exceptions
    from public.inventory_exceptions e
    where e.branch_id = p_branch_id
      and e.status in ('open', 'acknowledged')
      and (p_ingredient_id is null or e.ingredient_id = p_ingredient_id)
    group by e.ingredient_id
  ),
  price_alerts as (
    select
      a.ingredient_id,
      jsonb_agg(jsonb_build_object(
        'alertId', a.id,
        'alertType', a.alert_type,
        'previousValue', a.previous_value,
        'currentValue', a.current_value,
        'percentageChange', a.percentage_change,
        'status', a.status
      ) order by a.created_at desc) as alerts
    from public.inventory_price_variance_alerts a
    where a.branch_id = p_branch_id
      and a.status in ('open', 'acknowledged')
      and (p_ingredient_id is null or a.ingredient_id = p_ingredient_id)
    group by a.ingredient_id
  ),
  nearby_corrections as (
    select
      grouped.ingredient_id,
      jsonb_agg(jsonb_build_object(
        'sourceReference', grouped.source_reference,
        'movementIds', grouped.movement_ids,
        'lineCount', grouped.line_count,
        'netQuantity', grouped.net_quantity,
        'netValue', grouped.net_value
      )) as evidence
    from (
      select
        m.ingredient_id,
        m.source_reference,
        jsonb_agg(m.id order by m.effective_at, m.id) as movement_ids,
        count(*) as line_count,
        sum(m.signed_canonical_quantity) as net_quantity,
        sum(m.total_cost) as net_value
      from public.inventory_movements m
      join relevant_items ri on ri.ingredient_id = m.ingredient_id
      where m.branch_id = p_branch_id
        and m.status = 'posted'
        and m.movement_type in ('purchase_receipt', 'correction')
        and m.business_date between p_period_start and p_period_end
        and m.source_reference is not null
      group by m.ingredient_id, m.source_reference
      having count(*) > 1
    ) grouped
    group by grouped.ingredient_id
  ),
  costs as (
    select
      ri.ingredient_id,
      h.id as cost_history_id,
      h.weighted_average_cost,
      h.effective_at as cost_effective_at,
      case
        when h.id is null then 'NO_HISTORICAL_COST'
        when h.weighted_average_cost = 0 and i.legitimate_zero_cost then 'LEGITIMATE_ZERO_COST'
        when h.weighted_average_cost <= 0 then 'MISSING_COST'
        when p_period_end - h.effective_at::date > p_stale_cost_days then 'STALE_COST'
        else 'VALID_COST'
      end as cost_status
    from relevant_items ri
    join public.inventory_ingredients i on i.id = ri.ingredient_id
    left join lateral (
      select history.*
      from public.inventory_ingredient_cost_history history
      where history.branch_id = p_branch_id
        and history.ingredient_id = ri.ingredient_id
        and history.effective_at < ((p_period_end + 1)::timestamp at time zone 'Asia/Riyadh')
      order by history.effective_at desc, history.recorded_at desc, history.id desc
      limit 1
    ) h on true
  ),
  calculated as (
    select
      i.id as ingredient_id,
      i.canonical_name,
      i.inventory_classification,
      i.recipe_cost_eligible,
      i.base_inventory_unit,
      ma.opening_quantity,
      ma.purchases,
      ma.returns_to_supplier,
      ma.transfers_in,
      ma.transfers_out,
      ma.staff_meal,
      ma.operational_disposal,
      ma.recorded_waste,
      ma.production_input,
      ma.production_output,
      ma.actual_order_consumption,
      ma.complimentary,
      ma.adjustments_net,
      (
        ma.opening_quantity
        + ma.purchases
        + ma.transfers_in
        + ma.production_output
        + ma.adjustments_net
        - ma.returns_to_supplier
        - ma.transfers_out
        - ma.staff_meal
        - ma.operational_disposal
        - ma.recorded_waste
        - ma.production_input
        - ma.actual_order_consumption
        - ma.complimentary
      ) as ledger_expected_closing,
      lc.expected_quantity as count_expected_closing,
      lc.counted_quantity as physical_closing,
      case when lc.ingredient_id is null then null else lc.counted_quantity - lc.expected_quantity end
        as variance_quantity,
      lc.count_session_id,
      lc.stock_count_id,
      lc.business_date as count_business_date,
      lc.effective_at as count_effective_at,
      lc.canonical_unit,
      lc.selected_location_count,
      lc.counted_location_count,
      lc.warnings,
      lc.override_reasons,
      lc.count_evidence,
      ma.movement_evidence,
      fn.first_negative_date,
      c.cost_history_id,
      c.weighted_average_cost,
      c.cost_effective_at,
      c.cost_status,
      coalesce(ce.exceptions, '[]'::jsonb) as exceptions,
      coalesce(pa.alerts, '[]'::jsonb) as alerts,
      nc.evidence as nearby_correction_evidence
    from relevant_items ri
    join public.inventory_ingredients i on i.id = ri.ingredient_id
    join movement_aggregates ma on ma.ingredient_id = ri.ingredient_id
    left join latest_count lc on lc.ingredient_id = ri.ingredient_id
    left join first_negative fn on fn.ingredient_id = ri.ingredient_id
    left join costs c on c.ingredient_id = ri.ingredient_id
    left join current_exceptions ce on ce.ingredient_id = ri.ingredient_id
    left join price_alerts pa on pa.ingredient_id = ri.ingredient_id
    left join nearby_corrections nc on nc.ingredient_id = ri.ingredient_id
  ),
  relationship_edges as (
    select r.id, r.relationship_type, r.ingredient_id, r.related_ingredient_id
    from public.inventory_related_items r
    where r.branch_id = p_branch_id and r.active
    union all
    select r.id, r.relationship_type, r.related_ingredient_id, r.ingredient_id
    from public.inventory_related_items r
    where r.branch_id = p_branch_id and r.active
  ),
  related_evidence as (
    select
      c.ingredient_id,
      coalesce(jsonb_agg(jsonb_build_object(
        'relationshipId', edge.id,
        'relationshipType', edge.relationship_type,
        'inventoryItemId', related.ingredient_id,
        'itemName', related.canonical_name,
        'varianceQuantity', related.variance_quantity,
        'physicalClosing', related.physical_closing,
        'expectedClosing', related.count_expected_closing
      )) filter (where related.ingredient_id is not null), '[]'::jsonb) as related_items
    from calculated c
    left join relationship_edges edge on edge.ingredient_id = c.ingredient_id
    left join calculated related on related.ingredient_id = edge.related_ingredient_id
    group by c.ingredient_id
  )
  select jsonb_build_object(
    'branchId', p_branch_id,
    'periodStart', p_period_start,
    'periodEnd', p_period_end,
    'recipeCoveragePct', v_recipe_coverage,
    'theoreticalConsumptionAvailable', false,
    'theoreticalConsumptionReason', case
      when v_recipe_coverage < 80 then 'RECIPE_COVERAGE_GAP'
      else 'SALES_RECIPE_CONSUMPTION_LINK_UNAVAILABLE'
    end,
    'calculationMethod', 'LEDGER_PLUS_LATEST_POSTED_COUNT',
    'items', coalesce(jsonb_agg(jsonb_build_object(
      'inventoryItemId', c.ingredient_id,
      'itemName', c.canonical_name,
      'classification', c.inventory_classification,
      'recipeCostEligible', c.recipe_cost_eligible,
      'branchId', p_branch_id,
      'periodStart', p_period_start,
      'periodEnd', p_period_end,
      'analysisAsOf', coalesce(c.count_business_date, p_period_end),
      'canonicalUnit', coalesce(c.canonical_unit, c.base_inventory_unit),
      'openingQuantity', c.opening_quantity,
      'actual', jsonb_build_object(
        'purchases', c.purchases,
        'returnsToSupplier', c.returns_to_supplier,
        'transfersIn', c.transfers_in,
        'transfersOut', c.transfers_out,
        'staffMeal', c.staff_meal,
        'operationalDisposal', c.operational_disposal,
        'recordedWaste', c.recorded_waste,
        'productionInput', c.production_input,
        'productionOutput', c.production_output,
        'actualOrderConsumption', c.actual_order_consumption,
        'complimentary', c.complimentary,
        'adjustmentsNet', c.adjustments_net
      ),
      'theoreticalRecipeConsumption', null,
      'recipeCoveragePct', v_recipe_coverage,
      'ledgerExpectedClosing', c.ledger_expected_closing,
      'expectedClosing', coalesce(c.count_expected_closing, c.ledger_expected_closing),
      'physicalClosing', c.physical_closing,
      'varianceQuantity', c.variance_quantity,
      'historicalUnitCost', case
        when c.cost_status in ('VALID_COST', 'LEGITIMATE_ZERO_COST')
          then c.weighted_average_cost
        else null
      end,
      'costStatus', c.cost_status,
      'varianceValue', case
        when c.variance_quantity is not null
          and c.cost_status in ('VALID_COST', 'LEGITIMATE_ZERO_COST')
          then c.variance_quantity * c.weighted_average_cost
        else null
      end,
      'firstNegativeTheoreticalDate', c.first_negative_date,
      'countQuality', jsonb_build_object(
        'countSessionId', c.count_session_id,
        'stockCountId', c.stock_count_id,
        'businessDate', c.count_business_date,
        'effectiveAt', c.count_effective_at,
        'selectedLocationCount', c.selected_location_count,
        'countedLocationCount', c.counted_location_count,
        'hasUncountedLocation', coalesce(c.counted_location_count < c.selected_location_count, false),
        'hasUnresolvedUnit', coalesce(jsonb_path_exists(c.warnings, '$[*] ? (@.code == "pack_conversion_anomaly")'), false),
        'warnings', coalesce(c.warnings, '[]'::jsonb),
        'overrideReasons', coalesce(c.override_reasons, '[]'::jsonb),
        'expectedSnapshotDifference', case
          when c.count_expected_closing is null then null
          else c.count_expected_closing - c.ledger_expected_closing
        end,
        'latestCountAdjustmentExcluded', c.physical_closing is not null
      ),
      'openExceptions', c.exceptions,
      'priceAlerts', c.alerts,
      'nearbyCorrectionEvidence', c.nearby_correction_evidence,
      'relatedItems', re.related_items,
      'evidence', jsonb_build_object(
        'movements', c.movement_evidence,
        'counts', coalesce(c.count_evidence, '[]'::jsonb),
        'countSessionId', c.count_session_id,
        'stockCountId', c.stock_count_id,
        'costHistoryId', c.cost_history_id,
        'costEffectiveAt', c.cost_effective_at,
        'exceptionIds', coalesce(jsonb_path_query_array(c.exceptions, '$[*].exceptionId'), '[]'::jsonb),
        'physicalCountAdjustmentExcluded', c.physical_closing is not null
      ),
      'review', case when review.id is null then jsonb_build_object(
        'id', null,
        'status', 'OPEN',
        'resolutionReason', null,
        'correctiveReference', '{}'::jsonb
      ) else jsonb_build_object(
        'id', review.id,
        'status', review.status,
        'resolutionReason', review.resolution_reason,
        'correctiveReference', review.corrective_reference,
        'updatedAt', review.updated_at
      ) end
    ) order by abs(coalesce(c.variance_quantity, 0)) desc, c.canonical_name), '[]'::jsonb)
  )
  into v_result
  from calculated c
  join related_evidence re on re.ingredient_id = c.ingredient_id
  left join public.inventory_variance_reviews review
    on review.branch_id = p_branch_id
    and review.ingredient_id = c.ingredient_id
    and review.period_start = p_period_start
    and review.period_end = p_period_end;

  return v_result;
end;
$$;

revoke all on function public.inventory_variance_analysis(text, date, date, uuid, integer) from public;
grant execute on function public.inventory_variance_analysis(text, date, date, uuid, integer) to authenticated;

create or replace function public.inventory_set_variance_review(
  p_branch_id text,
  p_ingredient_id uuid,
  p_period_start date,
  p_period_end date,
  p_status text,
  p_reason text,
  p_corrective_reference jsonb default '{}'::jsonb,
  p_count_session_id uuid default null,
  p_stock_count_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_review public.inventory_variance_reviews%rowtype;
  v_previous public.inventory_variance_reviews%rowtype;
begin
  if p_status not in (
    'OPEN', 'REVIEWING', 'EXPLAINED', 'ACTION_REQUIRED', 'RESOLVED', 'DISMISSED'
  ) then
    raise exception 'Invalid variance review status' using errcode = '22023';
  end if;
  if p_period_end < p_period_start then
    raise exception 'Invalid variance review period' using errcode = '22023';
  end if;
  if p_status <> 'OPEN' and nullif(trim(p_reason), '') is null then
    raise exception 'Variance review reason is required' using errcode = '22023';
  end if;
  if not public.inventory_can_approve(p_branch_id) then
    raise exception 'Variance review update denied' using errcode = '42501';
  end if;
  if not exists (
    select 1 from public.inventory_ingredients i
    where i.id = p_ingredient_id
      and (i.branch_id is null or i.branch_id = p_branch_id)
  ) then
    raise exception 'Inventory item is not available for branch' using errcode = '42501';
  end if;

  select * into v_previous
  from public.inventory_variance_reviews
  where branch_id = p_branch_id
    and ingredient_id = p_ingredient_id
    and period_start = p_period_start
    and period_end = p_period_end
  for update;

  insert into public.inventory_variance_reviews (
    branch_id, ingredient_id, period_start, period_end,
    count_session_id, stock_count_id, status, resolution_reason,
    corrective_reference, created_by, updated_by, resolved_at
  ) values (
    p_branch_id, p_ingredient_id, p_period_start, p_period_end,
    p_count_session_id, p_stock_count_id, p_status, nullif(trim(p_reason), ''),
    coalesce(p_corrective_reference, '{}'::jsonb), auth.uid(), auth.uid(),
    case when p_status in ('RESOLVED', 'DISMISSED') then now() else null end
  )
  on conflict (branch_id, ingredient_id, period_start, period_end)
  do update set
    count_session_id = coalesce(excluded.count_session_id, inventory_variance_reviews.count_session_id),
    stock_count_id = coalesce(excluded.stock_count_id, inventory_variance_reviews.stock_count_id),
    status = excluded.status,
    resolution_reason = excluded.resolution_reason,
    corrective_reference = excluded.corrective_reference,
    updated_by = auth.uid(),
    updated_at = now(),
    resolved_at = case
      when excluded.status in ('RESOLVED', 'DISMISSED') then now()
      else null
    end
  returning * into v_review;

  insert into public.inventory_audit_log (
    event_type, actor_id, branch_id, entity_type, entity_id,
    previous_value, new_value, reason, metadata
  ) values (
    'inventory_variance_review_changed', auth.uid(), p_branch_id,
    'inventory_variance_review', v_review.id,
    case when v_previous.id is null then null else to_jsonb(v_previous) end,
    to_jsonb(v_review), coalesce(nullif(trim(p_reason), ''), 'variance_review_opened'),
    jsonb_build_object(
      'ingredientId', p_ingredient_id,
      'periodStart', p_period_start,
      'periodEnd', p_period_end,
      'sourceHistoryChanged', false
    )
  );

  return to_jsonb(v_review);
end;
$$;

revoke all on function public.inventory_set_variance_review(
  text, uuid, date, date, text, text, jsonb, uuid, uuid
) from public;
grant execute on function public.inventory_set_variance_review(
  text, uuid, date, date, text, text, jsonb, uuid, uuid
) to authenticated;

comment on function public.inventory_variance_analysis(text, date, date, uuid, integer) is
  'Read-only branch variance facts from canonical movements, latest posted physical count, historical WAC, exceptions, and related items. Latest count adjustment is excluded to preserve the variance under analysis.';
