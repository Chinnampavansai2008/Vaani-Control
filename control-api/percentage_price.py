"""Compute a single price change; never delegates arithmetic to the model."""
from decimal import Decimal, InvalidOperation, ROUND_HALF_UP

from fastapi import HTTPException


def percentage_price(current_price, operation, percentage):
    if type(current_price) is not int or current_price < 0:
        raise HTTPException(422, 'The current store price must be a nonnegative whole number.')
    if operation not in ('increase', 'decrease'):
        raise HTTPException(422, 'Specify whether to increase or decrease the price.')
    if type(percentage) not in (int, float, Decimal):
        raise HTTPException(422, 'Specify a numeric percentage greater than 0 and no greater than 100.')
    try:
        amount = Decimal(str(percentage))
        if not amount.is_finite() or not Decimal('0') < amount <= Decimal('100'):
            raise HTTPException(422, 'Percentage must be greater than 0 and no greater than 100.')
        if amount != amount.quantize(Decimal('0.01')):
            raise HTTPException(422, 'Use at most two decimal places for the percentage.')
        price = Decimal(current_price)
        change = price * amount / Decimal('100')
        proposed = price + change if operation == 'increase' else price - change
        rounded = int(proposed.quantize(Decimal('1'), rounding=ROUND_HALF_UP))
    except (InvalidOperation, ValueError, OverflowError):
        raise HTTPException(422, 'This percentage price change cannot be calculated safely. Use an exact price.') from None
    if rounded == current_price:
        raise HTTPException(422, 'This percentage leaves the price unchanged after whole-rupee rounding. Choose a different percentage or set an exact price.')
    return rounded
