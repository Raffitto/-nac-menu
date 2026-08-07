-- Allow the Phase B deterministic PO over-receipt exception.

alter table public.inventory_exceptions
  drop constraint if exists inventory_exceptions_exception_type_check;

alter table public.inventory_exceptions
  add constraint inventory_exceptions_exception_type_check check (exception_type in (
    'quantity_anomaly', 'unit_cost_anomaly', 'unexpected_unit_change',
    'quantity_cost_mismatch', 'possible_duplicate', 'pack_conversion_anomaly',
    'implausible_count', 'negative_theoretical_stock', 'missing_recipe_consumption',
    'opposing_related_sku_variance', 'zero_cost_anomaly', 'supplier_price_movement',
    'transfer_mismatch', 'production_yield_variance', 'over_receipt', 'needs_review'
  ));
