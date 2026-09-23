'use strict';

const PASSWORD_POLICY_MESSAGE = 'Password must be at least 8 characters and include an uppercase letter and a number.';

function passwordPolicyError(password) {
  if (typeof password !== 'string' || password.length < 8) return PASSWORD_POLICY_MESSAGE;
  if (!/[A-Z]/.test(password)) return PASSWORD_POLICY_MESSAGE;
  if (!/\d/.test(password)) return PASSWORD_POLICY_MESSAGE;
  return null;
}

function passwordMeetsPolicy(password) {
  return passwordPolicyError(password) === null;
}

module.exports = {
  PASSWORD_POLICY_MESSAGE,
  passwordPolicyError,
  passwordMeetsPolicy,
};
