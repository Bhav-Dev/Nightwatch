import { Platform } from 'react-native';
import Purchases, { type CustomerInfo, type PurchasesPackage } from 'react-native-purchases';

import { PAID_ENTITLEMENT } from '../../shared/api';
import { config } from '../config';

/**
 * Subscriptions through RevenueCat (App Store and Google Play). RevenueCat's app user id is
 * our user id, so its webhook can mirror the status to our server, which gates the paid
 * community slices. Products: an annual plan (default, 7-day trial) and a monthly plan.
 */
export interface Plans {
  yearly: { pkg: PurchasesPackage; price: string; perMonth: string | null } | null;
  monthly: { pkg: PurchasesPackage; price: string } | null;
}

let configuredFor: string | null = null;

function apiKey(): string {
  return Platform.OS === 'ios' ? config.revenueCatIosKey : config.revenueCatAndroidKey;
}

export const billingAvailable = () => apiKey().length > 0;

export async function configureBilling(userId: string): Promise<void> {
  if (!billingAvailable() || configuredFor === userId) return;
  if (configuredFor === null) Purchases.configure({ apiKey: apiKey(), appUserID: userId });
  else await Purchases.logIn(userId);
  configuredFor = userId;
}

export async function signOutBilling(): Promise<void> {
  if (configuredFor === null) return;
  await Purchases.logOut().catch(() => undefined);
  configuredFor = null;
}

export const isPaid = (info: CustomerInfo) => info.entitlements.active[PAID_ENTITLEMENT] !== undefined;

export async function currentEntitlement(): Promise<boolean> {
  if (configuredFor === null) return false;
  return isPaid(await Purchases.getCustomerInfo());
}

export function onEntitlementChange(listener: (paid: boolean) => void): () => void {
  if (configuredFor === null) return () => undefined;
  const l = (info: CustomerInfo) => listener(isPaid(info));
  Purchases.addCustomerInfoUpdateListener(l);
  return () => Purchases.removeCustomerInfoUpdateListener(l);
}

export async function loadPlans(): Promise<Plans> {
  if (configuredFor === null) return { yearly: null, monthly: null };
  const offerings = await Purchases.getOfferings();
  const current = offerings.current;
  const annual = current?.annual ?? null;
  const monthly = current?.monthly ?? null;
  return {
    yearly: annual
      ? { pkg: annual, price: annual.product.priceString, perMonth: annual.product.pricePerMonthString ?? null }
      : null,
    monthly: monthly ? { pkg: monthly, price: monthly.product.priceString } : null,
  };
}

/** Resolves true when the purchase unlocked the entitlement; false if the user cancelled. */
export async function purchase(pkg: PurchasesPackage): Promise<boolean> {
  try {
    const { customerInfo } = await Purchases.purchasePackage(pkg);
    return isPaid(customerInfo);
  } catch (e) {
    if ((e as { userCancelled?: boolean }).userCancelled) return false;
    throw e;
  }
}

export async function restore(): Promise<boolean> {
  if (configuredFor === null) return false;
  return isPaid(await Purchases.restorePurchases());
}
