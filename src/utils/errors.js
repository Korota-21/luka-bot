// خطأ متوقع يُعرض رسالته للمستخدم (مثل: ما عندك صلاحية)
class UserError extends Error {
  constructor(message) {
    super(message);
    this.name = 'UserError';
  }
}

module.exports = { UserError };
