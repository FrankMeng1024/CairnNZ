/**
 * validateBody — express middleware factory for Joi body validation.
 *
 * Usage:
 *   const { validateBody, schemas } = require('../middleware/validate');
 *   router.post('/', authenticate, validateBody(schemas.marker.create), handler);
 *
 * Design:
 * - Rejects with 400 + structured error (field + message) so client can display.
 * - stripUnknown: false — reject unknown fields (fail-loud, prevents typos silently
 *   accepted by ORM).
 * - abortEarly: false — return ALL errors at once (better DX than one at a time).
 * - Uses `error.details.map(...)` to shape response, no raw Joi internals leaked.
 *
 * Fields in `req.body` are REPLACED with the coerced/validated output so
 * downstream handlers use the sanitized version.
 */
'use strict';

function validateBody(schema) {
  return (req, res, next) => {
    const { value, error } = schema.validate(req.body, {
      abortEarly: false,
      stripUnknown: false,
      convert: true,
    });
    if (error) {
      const details = error.details.map((d) => ({
        field: d.path.join('.'),
        message: d.message,
      }));
      return res.status(400).json({
        error: 'Validation failed.',
        details,
      });
    }
    req.body = value;
    return next();
  };
}

module.exports = { validateBody };
